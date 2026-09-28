import type { GameView } from "./game";

export const API_URL = (import.meta.env.VITE_MULTIPLAYER_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
export type OnlineSession = { code: string; token: string; playerId: string };
type Reply = { view?: GameView; token?: string; playerId?: string; error?: string };
const storageKey = "chicappd-online-session";

function roomView(view: GameView | undefined): GameView {
  if (!view) throw new Error("Spelservern gav ett ofullständigt svar.");
  if (!view.settings || ![2, 5].includes(view.settings.finalTrickPoints) ||
    typeof view.settings.allowNegativeScores !== "boolean")
    throw new Error("Spelservern behöver uppdateras innan nya rum kan användas. Försök igen senare.");
  return view;
}

export function savedSession(): OnlineSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null") as OnlineSession | null;
    return value && typeof value.code === "string" && typeof value.token === "string" &&
      typeof value.playerId === "string" ? value : null;
  } catch { return null; }
}
export function saveSession(session: OnlineSession | null) {
  if (session) localStorage.setItem(storageKey, JSON.stringify(session));
  else localStorage.removeItem(storageKey);
}
async function call(path: string, init: RequestInit = {}): Promise<Reply> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init, headers: { "content-type": "application/json", ...init.headers },
    });
  } catch { throw new Error("Kunde inte nå spelservern. Kontrollera anslutningen."); }
  const data = await response.json() as Reply;
  if (!response.ok) throw new Error(data.error ?? "Något gick fel.");
  return data;
}
export async function enterOnline(name: string, code?: string) {
  const data = await call(code ? `/rooms/${encodeURIComponent(code)}/join` : "/rooms", {
    method: "POST", body: JSON.stringify({ name }),
  });
  const view = roomView(data.view);
  if (!data.token) throw new Error("Spelservern gav ett ofullständigt svar.");
  if (!data.playerId) throw new Error("Spelservern gav ingen spelaridentitet.");
  const session = { code: view.roomCode, token: data.token, playerId: data.playerId };
  saveSession(session);
  return { session, view };
}
export async function loadOnline(session: OnlineSession) {
  const data = await call(`/rooms/${session.code}/state`, {
    headers: { authorization: `Bearer ${session.token}` },
  });
  return roomView(data.view);
}
export async function commandOnline(session: OnlineSession, command: object) {
  const data = await call(`/rooms/${session.code}/command`, {
    method: "POST", headers: { authorization: `Bearer ${session.token}` }, body: JSON.stringify(command),
  });
  return roomView(data.view);
}
export function watchOnline(session: OnlineSession, onView: (view: GameView) => void,
  onStatus: (connected: boolean) => void) {
  let closed = false;
  let socket: WebSocket | null = null;
  let retry: number | undefined;
  let attempt = 0;
  const connect = () => {
    if (closed) return;
    const url = new URL(`${API_URL}/rooms/${session.code}/events`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", session.token);
    socket = new WebSocket(url);
    socket.onopen = () => { attempt = 0; onStatus(true); };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as { type: string; view?: GameView };
        if (message.type === "view" && message.view?.settings) onView(message.view);
      } catch { /* Ignore malformed network frames. */ }
    };
    socket.onclose = () => {
      onStatus(false);
      if (!closed) {
        retry = window.setTimeout(connect, Math.min(1000 * 2 ** attempt++, 8000));
        void loadOnline(session).then(onView).catch(() => {});
      }
    };
  };
  connect();
  return () => {
    closed = true;
    window.clearTimeout(retry);
    socket?.close();
  };
}
