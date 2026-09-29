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

test("leaving during a submitted exchange removes the player and resets the room", async () => {
  const owner = await call("/rooms", { method: "POST", body: { name: "Ada" } });
  const code = owner.view.roomCode;
  const guest = await call(`/rooms/${code}/join`, { method: "POST", body: { name: "Bo" } });
  const watcher = watch(code, owner.token);
  try {
    await until(() => watcher.messages.length > 0);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "start-round" } })).status, 200);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: guest.token,
      body: { type: "exchange", discardIds: [] } })).status, 200);
    const returned = await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "return-lobby" } });
    assert.equal(returned.status, 200);
    assert.equal(returned.view.phase, "lobby");
    assert.deepEqual(returned.view.exchangeSubmittedPlayerIds, []);
    assert.ok(returned.view.players.every((player) => player.handCount === 0));
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "start-round" } })).status, 200);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: guest.token,
      body: { type: "exchange", discardIds: [] } })).status, 200);
    assert.equal((await call(`/rooms/${code}/leave`, { method: "POST", token: guest.token })).status, 200);
    assert.equal((await call(`/rooms/${code}/state`, { token: guest.token })).status, 401);
    const lobby = (await call(`/rooms/${code}/state`, { token: owner.token })).view;
    assert.equal(lobby.phase, "lobby");
    assert.equal(lobby.players.length, 1);
    assert.equal(lobby.players[0].handCount, 0);
    assert.deepEqual(lobby.exchangeSubmittedPlayerIds, []);
    assert.deepEqual(lobby.activity, []);
    await until(() => watcher.messages.at(-1)?.view.phase === "lobby" &&
      watcher.messages.at(-1)?.view.players.length === 1);
    assert.equal((await call(`/rooms/${code}/leave`, { method: "POST", token: owner.token })).status, 200);
    assert.equal((await call(`/rooms/${code}/state`, { token: owner.token })).status, 404);
  } finally { watcher.socket.close(); }
});

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

test("four humans can join, play a full round, and a fifth is refused", async () => {
  const owner = await call("/rooms", { method: "POST", body: { name: "Ada" } });
  assert.equal(owner.status, 201);
  const code = owner.view.roomCode;
  const seats = [owner];
  for (const name of ["Bo", "Cy", "Dee"]) {
    const joined = await call(`/rooms/${code}/join`, { method: "POST", body: { name } });
    assert.equal(joined.status, 200);
    seats.push(joined);
    assert.equal(joined.view.players.length, seats.length);
  }
  assert.equal((await call(`/rooms/${code}/join`, { method: "POST", body: { name: "Eve" } })).status, 409);
  const watchers = seats.map((seat) => watch(code, seat.token));
  try {
    await until(() => watchers.every((watcher) => watcher.messages.length));
    assert.ok(watchers.every((watcher) => watcher.messages.at(-1).view.players.length === 4));
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: seats[1].token,
      body: { type: "start-round" } })).status, 409);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "start-round" } })).status, 200);
    await until(() => watchers.every((watcher) => watcher.messages.some((message) => message.view.phase === "table")));
    for (const seat of seats) {
      const view = (await call(`/rooms/${code}/state`, { token: seat.token })).view;
      assert.equal(view.players.length, 4);
      assert.deepEqual(view.players.map((player) => player.hand.length),
        seats.map((candidate) => candidate.playerId === seat.playerId ? 5 : 0));
    }
    for (let exchange = 0; exchange < 3; exchange++) {
      for (const [index, seat] of seats.entries()) {
        const result = await call(`/rooms/${code}/command`, { method: "POST", token: seat.token,
          body: { type: "exchange", discardIds: [] } });
        assert.equal(result.status, 200);
        assert.equal(result.view.exchangeCount, exchange + (index === 3 ? 1 : 0));
      }
    }
    for (let play = 0; play < 20; play++) {
      const state = (await call(`/rooms/${code}/state`, { token: owner.token })).view;
      const seat = seats.find((candidate) => candidate.playerId === state.activePlayerId);
      assert.ok(seat);
      const view = (await call(`/rooms/${code}/state`, { token: seat.token })).view;
      const hand = view.players.find((player) => player.id === seat.playerId).hand;
      const card = legalCards(hand, view.currentTrick[0]?.card.suit ?? null)[0];
      assert.ok(card);
      const result = await call(`/rooms/${code}/command`, { method: "POST", token: seat.token,
        body: { type: "play-card", cardId: card.id } });
      assert.equal(result.status, 200);
      if (result.view.waitingForNextTrick) {
        const startedWaiting = Date.now();
        while ((await call(`/rooms/${code}/state`, { token: owner.token })).view.waitingForNextTrick) {
          assert.ok(Date.now() - startedWaiting < 4000);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }
    const finished = (await call(`/rooms/${code}/state`, { token: owner.token })).view;
    assert.equal(finished.tableStage, "result");
    assert.equal(finished.completedTricks.length, 5);
    assert.equal(finished.players.reduce((sum, player) => sum + player.score, 0),
      finished.handAwards.reduce((sum, award) => sum + award.points, 0) + finished.finalTrickAward.points);
    await until(() => watchers.every((watcher) => watcher.messages.at(-1)?.view.tableStage === "result"));
  } finally { watchers.forEach((watcher) => watcher.socket.close()); }
});
