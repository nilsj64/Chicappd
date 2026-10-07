import { DurableObject } from "cloudflare:workers";
import { applyCommand, createRoom, randomRoomCode, viewForPlayer, roomCapacity, needsTimedBotExchange, needsChicagoDecision, CPU_EXCHANGE_PAUSE_MS } from "../src/game.ts";
import type { GameCommand, GameSettings, GameState } from "../src/game.ts";

type Env = { ROOMS: DurableObjectNamespace<GameRoom>; FRONTEND_ORIGIN: string };
type Session = { playerId: string; token: string };
type Saved = { game: GameState; sessions: Session[]; version: number };
const codePattern = /^[A-HJ-NP-Z2-9]{5}$/;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(24)),
  (byte) => byte.toString(16).padStart(2, "0")).join("");
const validName = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= 24;

export class GameRoom extends DurableObject<Env> {
  private waitingForChicagoDecision(game: GameState): boolean {
    return needsChicagoDecision(game) &&
      game.players.find((player) => player.id === game.activePlayerId)?.control === "bot";
  }
  private advanceBots(game: GameState): GameState {
    if (this.waitingForChicagoDecision(game)) return game;
    let next = game;
    for (let turn = 0; turn < 20 && next.phase === "table" &&
      next.tableStage === "tricks" && !next.waitingForNextTrick &&
      next.players.find((player) => player.id === next.activePlayerId)?.control === "bot"; turn++) {
      const advanced = applyCommand(next, { type: "advance-bot", actorId: next.ownerId });
      if (advanced === next) break;
      next = advanced;
    }
    return next;
  }
  private async saved(): Promise<Saved | undefined> {
    return this.ctx.storage.get<Saved>("room");
  }
  private view(saved: Saved, playerId: string) {
    const view = viewForPlayer(saved.game, playerId);
    return view ? { ...view, revision: saved.version } : null;
  }
  private async persist(saved: Saved) {
    saved.version += 1;
    await this.ctx.storage.put("room", saved);
    this.broadcast(saved);
  }
  private broadcast(saved: Saved) {
    for (const socket of this.ctx.getWebSockets()) {
      const playerId = socket.deserializeAttachment() as string;
      const view = this.view(saved, playerId);
      if (view) try { socket.send(JSON.stringify({ type: "view", view })); } catch { socket.close(); }
    }
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const body = request.method === "POST" ? await request.json().catch(() => null) : null;
    let saved = await this.saved();
    if (path === "/create" && request.method === "POST") {
      if (saved) return json({ error: "Koden används redan." }, 409);
      const name = (body as { name?: unknown } | null)?.name;
      if (!validName(name)) return json({ error: "Ange ett namn med högst 24 tecken." }, 400);
      const playerId = crypto.randomUUID();
      const game = createRoom(name.trim(), url.searchParams.get("code")!, playerId);
      const session = { playerId, token: token() };
      saved = { game, sessions: [session], version: 0 };
      await this.persist(saved);
      return json({ token: session.token, playerId, view: this.view(saved, playerId) }, 201);
    }
    if (!saved) return json({ error: "Rummet finns inte." }, 404);
    if (path === "/join" && request.method === "POST") {
      const name = (body as { name?: unknown } | null)?.name;
      if (!validName(name)) return json({ error: "Ange ett namn med högst 24 tecken." }, 400);
      if (saved.game.phase !== "lobby" || saved.game.players.length >= roomCapacity(saved.game))
        return json({ error: "Rummet är fullt eller spelet har startat." }, 409);
      const playerId = crypto.randomUUID();
      const next = applyCommand(saved.game, {
        type: "add-human", actorId: saved.game.ownerId, playerId, name: name.trim(),
      });
      if (next === saved.game) return json({ error: "Kunde inte gå med." }, 409);
      const session = { playerId, token: token() };
      saved = { ...saved, game: next, sessions: [...saved.sessions, session] };
      await this.persist(saved);
      return json({ token: session.token, playerId, view: this.view(saved, playerId) });
    }
    const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "");
    const session = saved.sessions.find((item) => item.token === bearer);
    if (path === "/events" && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const wsSession = saved.sessions.find((item) => item.token === url.searchParams.get("token"));
      if (!wsSession) return json({ error: "Ogiltig spelarsession." }, 401);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment(wsSession.playerId);
      server.send(JSON.stringify({ type: "view", view: this.view(saved, wsSession.playerId) }));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (!session) return json({ error: "Ogiltig spelarsession." }, 401);
    if (path === "/state" && request.method === "GET")
      return json({ view: this.view(saved, session.playerId) });
    if (path === "/leave" && request.method === "POST") {
      const next = applyCommand(saved.game, {
        type: "remove-player", actorId: session.playerId, playerId: session.playerId,
      });
      if (next === saved.game) return json({ error: "Kunde inte lämna rummet." }, 409);
      saved = { ...saved, game: next, sessions: saved.sessions.filter((item) => item.token !== session.token) };
      await this.persist(saved);
      for (const socket of this.ctx.getWebSockets()) {
        if (socket.deserializeAttachment() === session.playerId) socket.close();
      }
      if (!next.players.length) await this.ctx.storage.delete("room");
      return json({ left: true });
    }
    if (path === "/command" && request.method === "POST") {
      const input = body as { type?: unknown; discardIds?: unknown; cardId?: unknown; accept?: unknown;
        playerId?: unknown; settings?: GameSettings } | null;
      let command: GameCommand | null = null;
      if (input?.type === "start-round") command = { type: "start-round", actorId: session.playerId };
      if (input?.type === "exchange" && Array.isArray(input.discardIds) &&
        input.discardIds.length <= 5 && input.discardIds.every((id) => typeof id === "string"))
        command = { type: "exchange", actorId: session.playerId, discardIds: input.discardIds };
      if (input?.type === "exchange-choice" && typeof input.accept === "boolean")
        command = { type: "exchange-choice", actorId: session.playerId, accept: input.accept };
      if (input?.type === "play-card" && typeof input.cardId === "string")
        command = { type: "play-card", actorId: session.playerId, cardId: input.cardId };
      if (input?.type === "pass-chicago") command = { type: "pass-chicago", actorId: session.playerId };
      if (input?.type === "declare-chicago") command = { type: "declare-chicago", actorId: session.playerId };
      if (input?.type === "set-settings" && input.settings)
        command = { type: "set-settings", actorId: session.playerId, settings: input.settings };
      if (input?.type === "add-bot") command = { type: "add-bot", actorId: session.playerId };
      if (input?.type === "remove-bot" && typeof input.playerId === "string" &&
        saved.game.players.some((player) => player.id === input.playerId && player.control === "bot"))
        command = { type: "remove-player", actorId: session.playerId, playerId: input.playerId };
      if (input?.type === "return-lobby") command = { type: "return-lobby", actorId: session.playerId };
      if (!command) return json({ error: "Ogiltigt drag." }, 400);
      const applied = applyCommand(saved.game, command);
      if (applied === saved.game) return json({ error: "Draget är inte tillåtet just nu.", view: this.view(saved, session.playerId) }, 409);
      const next = this.advanceBots(applied);
      saved = { ...saved, game: next };
      if (needsTimedBotExchange(next) || next.waitingForNextTrick || next.pendingExchange &&
        next.players.find((p) => p.id === next.pendingExchange?.playerId)?.control === "bot")
        await this.ctx.storage.setAlarm(next.pendingExchange?.revealUntil ??
          Date.now() + CPU_EXCHANGE_PAUSE_MS);
      await this.persist(saved);
      return json({ view: this.view(saved, session.playerId) });
    }
    return json({ error: "Okänd begäran." }, 404);
  }
  async alarm() {
    const saved = await this.saved();
    if (!saved || (!saved.game.waitingForNextTrick && !saved.game.pendingExchange && !needsTimedBotExchange(saved.game))) return;
    const next = this.advanceBots(applyCommand(saved.game, {
      type: saved.game.pendingExchange || needsTimedBotExchange(saved.game) ? "advance-bot" : "continue-trick", actorId: saved.game.ownerId,
    }));
    if (needsTimedBotExchange(next) || next.waitingForNextTrick || next.pendingExchange &&
      next.players.find((p) => p.id === next.pendingExchange?.playerId)?.control === "bot")
      await this.ctx.storage.setAlarm(next.pendingExchange?.revealUntil ??
          Date.now() + CPU_EXCHANGE_PAUSE_MS);
    if (next !== saved.game) await this.persist({ ...saved, game: next });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin");
    const allowed = origin === env.FRONTEND_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin ?? "");
    if (origin && !allowed) return json({ error: "Otillåtet ursprung." }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
      "access-control-allow-origin": origin ?? env.FRONTEND_ORIGIN,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": "86400",
    } });
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/rooms\/([A-HJ-NP-Z2-9]{5})\/(join|state|command|events|leave)$/);
    let response: Response;
    if (url.pathname === "/rooms" && request.method === "POST") {
      const body = await request.text();
      response = json({ error: "Kunde inte skapa ett unikt rum." }, 503);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomRoomCode();
        const stub = env.ROOMS.getByName(code);
        const candidate = await stub.fetch(new Request(`https://room.internal/create?code=${code}`, {
          method: "POST", headers: { "content-type": "application/json" }, body,
        }));
        if (candidate.status !== 409) { response = candidate; break; }
      }
    } else if (match && codePattern.test(match[1])) {
      const stub = env.ROOMS.getByName(match[1]);
      response = await stub.fetch(new Request(`https://room.internal/${match[2]}${url.search}`, request));
    } else response = json({ error: "Okänd begäran." }, 404);
    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    headers.set("access-control-allow-origin", origin ?? env.FRONTEND_ORIGIN);
    headers.set("vary", "Origin");
    return new Response(response.body, { status: response.status, headers });
  },
};
