// Run against `npm run server:dev` with `npm run test:online`.
import test from "node:test";
import assert from "node:assert/strict";
import { legalCards } from "../src/tricks.ts";

const base = process.env.CHICAPPD_TEST_API ?? "http://localhost:8787";
async function call(path, { method = "GET", token, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, ...await response.json() };
}
function watch(code, token) {
  const socket = new WebSocket(`${base.replace(/^http/, "ws")}/rooms/${code}/events?token=${token}`);
  const messages = [];
  socket.addEventListener("message", (event) => messages.push(JSON.parse(event.data)));
  return { socket, messages };
}
async function until(predicate, timeout = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("Timed out waiting for realtime update");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("two real room clients complete a round with private hands and live updates", async () => {
  const a = await call("/rooms", { method: "POST", body: { name: "Ada" } });
  assert.equal(a.status, 201);
  const code = a.view.roomCode;
  const b = await call(`/rooms/${code}/join`, { method: "POST", body: { name: "Bo" } });
  assert.equal(b.status, 200);
  assert.notEqual(a.token, b.token);
  const wa = watch(code, a.token);
  const wb = watch(code, b.token);
  try {
    await until(() => wa.messages.length && wb.messages.length);
    assert.equal(wa.messages.at(-1).view.players.length, 2);
    assert.equal(wb.messages.at(-1).view.players.length, 2);
    assert.equal((await call(`/rooms/${code}/join`, { method: "POST", body: { name: "Cy" } })).status, 409);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: b.token, body: { type: "start-round" } })).status, 409);
    const started = await call(`/rooms/${code}/command`, { method: "POST", token: a.token, body: { type: "start-round" } });
    assert.equal(started.status, 200);
    await until(() => wb.messages.some((m) => m.view.phase === "table"));
    await until(() => wa.messages.some((m) => m.view.phase === "table"));
    let av = (await call(`/rooms/${code}/state`, { token: a.token })).view;
    let bv = (await call(`/rooms/${code}/state`, { token: b.token })).view;
    assert.equal(av.players[0].hand.length, 5);
    assert.equal(av.players[1].hand.length, 0);
    assert.equal(bv.players[0].hand.length, 0);
    assert.equal(bv.players[1].hand.length, 5);
    assert.equal(JSON.stringify(av).includes(bv.players[1].hand[0].id), false);
    assert.equal(JSON.stringify(bv).includes(av.players[0].hand[0].id), false);
    assert.equal(JSON.stringify(wa.messages.at(-1).view).includes(bv.players[1].hand[0].id), false);
    assert.equal(JSON.stringify(wb.messages.at(-1).view).includes(av.players[0].hand[0].id), false);
    assert.equal((await fetch(`${base}/rooms/${code}/state`, { headers: { origin: "https://evil.example", authorization: `Bearer ${a.token}` } })).status, 403);
    assert.equal((await call(`/rooms/${code}/state`, { token: "wrong" })).status, 401);
    for (let exchange = 0; exchange < 3; exchange++) {
      assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: a.token,
        body: { type: "exchange", discardIds: [] } })).status, 200);
      assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: a.token,
        body: { type: "exchange", discardIds: [] } })).status, 409);
      const done = await call(`/rooms/${code}/command`, { method: "POST", token: b.token,
        body: { type: "exchange", discardIds: [] } });
      assert.equal(done.status, 200);
      assert.equal(done.view.exchangeCount, exchange + 1);
    }
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: b.token,
      body: { type: "play-card", cardId: bv.players[1].hand[0].id } })).status, 409);
    for (let play = 0; play < 10; play++) {
      av = (await call(`/rooms/${code}/state`, { token: a.token })).view;
      bv = (await call(`/rooms/${code}/state`, { token: b.token })).view;
      const view = av.activePlayerId === a.playerId ? av : bv;
      const actor = view.activePlayerId === a.playerId ? a : b;
      const own = view.players.find((p) => p.id === actor.playerId);
      const card = legalCards(own.hand, view.currentTrick[0]?.card.suit ?? null)[0];
      const played = await call(`/rooms/${code}/command`, { method: "POST", token: actor.token,
        body: { type: "play-card", cardId: card.id } });
      assert.equal(played.status, 200);
      assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: actor.token,
        body: { type: "play-card", cardId: card.id } })).status, 409);
      if (played.view.waitingForNextTrick) {
        const startedWaiting = Date.now();
        while ((await call(`/rooms/${code}/state`, { token: a.token })).view.waitingForNextTrick) {
          assert.ok(Date.now() - startedWaiting < 4000);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }
    av = (await call(`/rooms/${code}/state`, { token: a.token })).view;
    bv = (await call(`/rooms/${code}/state`, { token: b.token })).view;
    assert.equal(av.tableStage, "result");
    assert.equal(bv.tableStage, "result");
    assert.equal(av.completedTricks.length, 5);
    assert.deepEqual(av.players.map((p) => p.score), bv.players.map((p) => p.score));
    assert.equal(av.players.reduce((sum, p) => sum + p.score, 0),
      av.handAwards.reduce((sum, award) => sum + award.points, 0) + 5);
    const next = await call(`/rooms/${code}/command`, { method: "POST", token: b.token,
      body: { type: "start-round" } });
    assert.equal(next.status, 200);
    assert.equal(next.view.tableStage, "exchange");
    assert.equal(next.view.exchangeCount, 0);
    assert.deepEqual(next.view.players.map((p) => p.score), av.players.map((p) => p.score));
    const resumed = watch(code, a.token);
    try {
      await until(() => resumed.messages.some((m) => m.view.tableStage === "exchange"));
      assert.equal(resumed.messages.at(-1).view.players[0].hand.length, 5);
      assert.equal(resumed.messages.at(-1).view.players[1].hand.length, 0);
    } finally { resumed.socket.close(); }
    await until(() => wb.messages.at(-1)?.view.exchangeCount === 0 &&
      wb.messages.at(-1)?.view.completedTricks.length === 0);
  } finally { wa.socket.close(); wb.socket.close(); }
});
