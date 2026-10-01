// Run against `npm run server:dev` with `npm run test:online`.
import test from "node:test";
import assert from "node:assert/strict";
import { legalCards } from "../src/tricks.ts";

const base = process.env.CHICAPPD_TEST_API ?? "http://localhost:8787";
async function call(path, { method = "GET", token, body, settleBots = true } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = { status: response.status, ...await response.json() };
  if (settleBots && path.endsWith("/command") && result.status === 200) {
    const started = Date.now();
    while (result.view?.pendingExchange && result.view.players.find(p => p.id === result.view.pendingExchange.playerId)?.control === "bot") {
      assert.ok(Date.now() - started < 20000, "CPU offers must settle through Worker alarms");
      await new Promise(resolve => setTimeout(resolve, 100));
      result.view = (await call(path.replace(/command$/, "state"), { token })).view;
    }
  }
  return result;
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

test("single-card choice is shared online while the rejected replacement stays private", async () => {
  const owner = await call("/rooms", { method: "POST", body: { name: "Ada" } });
  const code = owner.view.roomCode;
  const guest = await call(`/rooms/${code}/join`, { method: "POST", body: { name: "Bo" } });
  try {
    let view = (await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "start-round" } })).view;
    const initialOwnerIds = new Set(view.players[0].hand.map((card) => card.id));
    const discarded = view.players[0].hand[0].id;
    view = (await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "exchange", discardIds: [discarded] } })).view;
    const shown = view.pendingExchange.card.id;
    const guestView = (await call(`/rooms/${code}/state`, { token: guest.token })).view;
    assert.equal(guestView.pendingExchange.card.id, shown);
    assert.equal(guestView.players[0].hand.length, 0);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: guest.token,
      body: { type: "exchange-choice", accept: true } })).status, 409);
    const rejected = await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "exchange-choice", accept: false } });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.view.pendingExchange, null);
    assert.equal(rejected.view.players[0].hand.some((card) => card.id === shown), false);
    const hidden = rejected.view.players[0].hand.find((card) => !initialOwnerIds.has(card.id));
    assert.ok(hidden);
    const guestAfter = (await call(`/rooms/${code}/state`, { token: guest.token })).view;
    assert.equal(JSON.stringify(guestAfter).includes(hidden.id), false);
    assert.equal(guestAfter.exchangeEvents[0].singleCardChoice, "rejected");
    assert.ok(guestAfter.activity.some(message => message.includes("Ada avstod från det presenterade kortet och fick ett nytt kort")));
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "exchange-choice", accept: true } })).status, 409);
    const guestCard = guestAfter.players[1].hand[0].id;
    const offered = await call(`/rooms/${code}/command`, { method: "POST", token: guest.token,
      body: { type: "exchange", discardIds: [guestCard] } });
    assert.equal(offered.status, 200);
    assert.equal((await call(`/rooms/${code}/state`, { token: owner.token })).view.pendingExchange.card.id,
      offered.view.pendingExchange.card.id);
    const accepted = await call(`/rooms/${code}/command`, { method: "POST", token: guest.token,
      body: { type: "exchange-choice", accept: true } });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.view.players[1].hand.some((card) => card.id === offered.view.pendingExchange.card.id), true);
    const ownerAfter = (await call(`/rooms/${code}/state`, { token: owner.token })).view;
    assert.equal(ownerAfter.exchangeEvents.at(-1).singleCardChoice, "accepted");
    assert.ok(ownerAfter.activity.some(message => message.includes("Bo tog det presenterade kortet")));
  } finally {
    await call(`/rooms/${code}/leave`, { method: "POST", token: guest.token });
    await call(`/rooms/${code}/leave`, { method: "POST", token: owner.token });
  }
});

async function finishRoomWithBots(code, seats) {
  const byId = new Map(seats.map((seat) => [seat.playerId, seat]));
  for (let turn = 0; turn < 150; turn++) {
    const state = (await call(`/rooms/${code}/state`, { token: seats[0].token })).view;
    if (state.tableStage === "result") return state;
    if (state.waitingForNextTrick) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    const actor = byId.get(state.activePlayerId);
    if (!actor) {
      await new Promise(resolve => setTimeout(resolve, 100));
      continue;
    }
    const view = (await call(`/rooms/${code}/state`, { token: actor.token })).view;
    const hand = view.players.find((player) => player.id === actor.playerId).hand;
    const card = legalCards(hand, view.currentTrick[0]?.card.suit ?? null)[0];
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: actor.token,
      body: { type: "play-card", cardId: card.id } })).status, 200);
  }
  throw new Error("Room with bots did not finish five tricks");
}

test("an online room with one human and CPU players completes a round", async () => {
  const owner = await call("/rooms", { method: "POST", body: { name: "Ada" } });
  const code = owner.view.roomCode;
  try {
    for (let i = 0; i < 3; i++)
      assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
        body: { type: "add-bot" } })).status, 200);
    let view = (await call(`/rooms/${code}/state`, { token: owner.token })).view;
    assert.deepEqual(view.players.map((player) => player.control), ["human", "bot", "bot", "bot"]);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "start-round" } })).status, 200);
    for (let exchange = 0; exchange < 3; exchange++) {
      view = (await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
        body: { type: "exchange", discardIds: [] } })).view;
      assert.equal(view.exchangeCount, exchange + 1);
    }
    const finished = await finishRoomWithBots(code, [owner]);
    assert.equal(finished.completedTricks.length, 5);
    assert.equal(finished.players.length, 4);
  } finally { await call(`/rooms/${code}/leave`, { method: "POST", token: owner.token }); }
});

test("a mixed online room lets the owner add and remove CPU before playing", async () => {
  const owner = await call("/rooms", { method: "POST", body: { name: "Ada" } });
  const code = owner.view.roomCode;
  const guest = await call(`/rooms/${code}/join`, { method: "POST", body: { name: "Bo" } });
  const ownerWatcher = watch(code, owner.token);
  const guestWatcher = watch(code, guest.token);
  try {
    await until(() => ownerWatcher.messages.length && guestWatcher.messages.length);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: guest.token,
      body: { type: "add-bot" } })).status, 409);
    const added = await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "add-bot" } });
    assert.equal(added.status, 200);
    assert.equal(added.view.phase, "lobby");
    await until(() => [ownerWatcher, guestWatcher].every((watcher) =>
      watcher.messages.at(-1)?.view.players.length === 3));
    assert.deepEqual(guestWatcher.messages.at(-1).view.players.map((player) => player.control),
      ["human", "human", "bot"]);
    const botId = added.view.players[2].id;
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: guest.token,
      body: { type: "remove-bot", playerId: botId } })).status, 409);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "remove-bot", playerId: botId } })).status, 200);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "add-bot" } })).status, 200);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "add-bot" } })).status, 200);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "add-bot" } })).status, 409);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "remove-bot", playerId: added.view.players[2].id } })).status, 200);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "start-round" } })).status, 200);
    for (let exchange = 0; exchange < 3; exchange++) {
      assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
        body: { type: "exchange", discardIds: [] } })).status, 200);
      assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: guest.token,
        body: { type: "exchange", discardIds: [] } })).status, 200);
    }
    const finished = await finishRoomWithBots(code, [owner, guest]);
    assert.deepEqual(finished.players.map((player) => player.control), ["human", "human", "bot"]);
    assert.equal(finished.completedTricks.length, 5);
  } finally {
    ownerWatcher.socket.close();
    guestWatcher.socket.close();
    await call(`/rooms/${code}/leave`, { method: "POST", token: guest.token });
    await call(`/rooms/${code}/leave`, { method: "POST", token: owner.token });
  }
});

test("leaving during a submitted exchange removes the player and resets the room", async () => {
  const owner = await call("/rooms", { method: "POST", body: { name: "Ada" } });
  const code = owner.view.roomCode;
  const guest = await call(`/rooms/${code}/join`, { method: "POST", body: { name: "Bo" } });
  const watcher = watch(code, owner.token);
  try {
    await until(() => watcher.messages.length > 0);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "start-round" } })).status, 200);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
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

test("leaving the lobby transfers ownership and updates the remaining client", async () => {
  const owner = await call("/rooms", { method: "POST", body: { name: "Ada" } });
  const code = owner.view.roomCode;
  const guest = await call(`/rooms/${code}/join`, { method: "POST", body: { name: "Bo" } });
  const watcher = watch(code, guest.token);
  try {
    await until(() => watcher.messages.length > 0);
    assert.equal((await call(`/rooms/${code}/leave`, { method: "POST", token: owner.token })).status, 200);
    assert.equal((await call(`/rooms/${code}/state`, { token: owner.token })).status, 401);
    await until(() => watcher.messages.at(-1)?.view.players.length === 1);
    const lobby = watcher.messages.at(-1).view;
    assert.equal(lobby.phase, "lobby");
    assert.equal(lobby.ownerId, guest.playerId);
    assert.deepEqual(lobby.players.map((player) => player.id), [guest.playerId]);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: guest.token,
      body: { type: "add-bot" } })).status, 200);
  } finally {
    watcher.socket.close();
    await call(`/rooms/${code}/leave`, { method: "POST", token: guest.token });
  }
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
    assert.equal(next.view.roundStarterId, b.playerId);
    assert.equal(next.view.activePlayerId, b.playerId);
    assert.deepEqual(next.view.players.map((p) => p.score), av.players.map((p) => p.score));
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: a.token,
      body: { type: "exchange", discardIds: [] } })).status, 409);
    const secondRoundExchange = await call(`/rooms/${code}/command`, { method: "POST", token: b.token,
      body: { type: "exchange", discardIds: [] } });
    assert.equal(secondRoundExchange.status, 200);
    assert.deepEqual(secondRoundExchange.view.exchangeEvents.map((event) => event.playerId), [b.playerId]);
    assert.equal(secondRoundExchange.view.activePlayerId, a.playerId);
    assert.deepEqual((await call(`/rooms/${code}/state`, { token: a.token })).view.exchangeEvents,
      secondRoundExchange.view.exchangeEvents);
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

for (const count of [2, 3, 4, 5, 6]) test(`${count} humans can join and play a full round`, async () => {
  const owner = await call("/rooms", { method: "POST", body: { name: "Ada" } });
  assert.equal(owner.status, 201);
  const code = owner.view.roomCode;
  const seats = [owner];
  for (const name of ["Bo", "Cy", "Dee", "Eve", "Flo"].slice(0, count - 1)) {
    const joined = await call(`/rooms/${code}/join`, { method: "POST", body: { name } });
    assert.equal(joined.status, 200);
    seats.push(joined);
    assert.equal(joined.view.players.length, seats.length);
  }
  if (count === 6) {
    assert.equal((await call(`/rooms/${code}/join`, { method: "POST", body: { name: "Seventh" } })).status, 409);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token, body: { type: "add-bot" } })).status, 409);
  }
  const watchers = seats.map((seat) => watch(code, seat.token));
  try {
    await until(() => watchers.every((watcher) => watcher.messages.length));
    assert.ok(watchers.every((watcher) => watcher.messages.at(-1).view.players.length === count));
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: seats[1].token,
      body: { type: "start-round" } })).status, 409);
    assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token,
      body: { type: "start-round" } })).status, 200);
    await until(() => watchers.every((watcher) => watcher.messages.some((message) => message.view.phase === "table")));
    for (const seat of seats) {
      const view = (await call(`/rooms/${code}/state`, { token: seat.token })).view;
      assert.equal(view.players.length, count);
      assert.deepEqual(view.players.map((player) => player.hand.length),
        seats.map((candidate) => candidate.playerId === seat.playerId ? 5 : 0));
    }
    for (let exchange = 0; exchange < 3; exchange++) {
      for (const [index, seat] of seats.entries()) {
        const result = await call(`/rooms/${code}/command`, { method: "POST", token: seat.token,
          body: { type: "exchange", discardIds: [] } });
        assert.equal(result.status, 200);
        assert.equal(result.view.exchangeCount, exchange + (index === count - 1 ? 1 : 0));
      }
    }
    for (let play = 0; play < count * 5; play++) {
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

test("optional rules default off, sync to opponents and survive round start and reload", async () => {
  const owner = await call("/rooms", { method: "POST", body: { name: "Ada" } });
  const code = owner.view.roomCode;
  const guest = await call(`/rooms/${code}/join`, { method: "POST", body: { name: "Bea" } });
  try {
    assert.equal(owner.view.settings.firstChicagoBreakBonus, false);
    assert.equal(owner.view.settings.resetOver52WithoutChicago, false);
    for (const firstChicagoBreakBonus of [false, true]) {
      for (const resetOver52WithoutChicago of [false, true]) {
        const settings = { ...owner.view.settings, firstChicagoBreakBonus, resetOver52WithoutChicago };
        assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: guest.token, body: { type: "set-settings", settings } })).status, 409);
        const changed = await call(`/rooms/${code}/command`, { method: "POST", token: owner.token, body: { type: "set-settings", settings } });
        assert.equal(changed.status, 200);
        assert.deepEqual(changed.view.settings, settings);
        assert.deepEqual((await call(`/rooms/${code}/state`, { token: guest.token })).view.settings, settings);
      }
    }
    const started = await call(`/rooms/${code}/command`, { method: "POST", token: owner.token, body: { type: "start-round" } });
    assert.equal(started.view.settings.firstChicagoBreakBonus, true);
    assert.equal(started.view.settings.resetOver52WithoutChicago, true);
    assert.deepEqual((await call(`/rooms/${code}/state`, { token: guest.token })).view.settings, started.view.settings);
  } finally {
    await call(`/rooms/${code}/leave`, { method: "POST", token: guest.token });
    await call(`/rooms/${code}/leave`, { method: "POST", token: owner.token });
  }
});

test("online seats preserve the full 24-character account username", async () => {
  const name="abcdefghijklmnopqrstuvwx";
  const owner=await call("/rooms",{method:"POST",body:{name}});
  assert.equal(owner.status,201);assert.equal(owner.view.players[0].name,name);
  const code=owner.view.roomCode;
  const guest=await call(`/rooms/${code}/join`,{method:"POST",body:{name:"zyxwvutsrqponmlkjihgfedc"}});
  try {
    assert.equal(guest.status,200);assert.equal(guest.view.players[1].name,"zyxwvutsrqponmlkjihgfedc");
    const bad=await call(`/rooms/${code}/join`,{method:"POST",body:{name:name+"y"}});
    assert.equal(bad.status,400);assert.match(bad.error,/24/);
  } finally {
    if(guest.token)await call(`/rooms/${code}/leave`,{method:"POST",token:guest.token});
    await call(`/rooms/${code}/leave`,{method:"POST",token:owner.token});
  }
});

test("Chicago victory requirement defaults ON and chosen ON/OFF survives Worker reload and round start", async () => {
  for (const chicagoRequiredToWin of [false, true]) {
    const owner = await call("/rooms", { method: "POST", body: { name: "Rule owner" } });
    const code = owner.view.roomCode;
    const guest = await call(`/rooms/${code}/join`, { method: "POST", body: { name: "Rule guest" } });
    try {
      assert.equal(owner.view.settings.chicagoRequiredToWin, true);
      const settings = { ...owner.view.settings, chicagoRequiredToWin };
      assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: guest.token, body: { type: "set-settings", settings } })).status, 409);
      assert.equal((await call(`/rooms/${code}/command`, { method: "POST", token: owner.token, body: { type: "set-settings", settings } })).status, 200);
      const watcher = watch(code, guest.token);
      try {
        await until(() => watcher.messages.length);
        assert.equal(watcher.messages.at(-1).view.settings.chicagoRequiredToWin, chicagoRequiredToWin);
        const started = await call(`/rooms/${code}/command`, { method: "POST", token: owner.token, body: { type: "start-round" } });
        assert.equal(started.view.settings.chicagoRequiredToWin, chicagoRequiredToWin);
        assert.equal((await call(`/rooms/${code}/state`, { token: guest.token })).view.settings.chicagoRequiredToWin, chicagoRequiredToWin);
        await until(() => watcher.messages.at(-1).view.phase === "table");
        assert.equal(watcher.messages.at(-1).view.settings.chicagoRequiredToWin, chicagoRequiredToWin);
      } finally { watcher.socket.close(); }
    } finally {
      await call(`/rooms/${code}/leave`, { method: "POST", token: guest.token });
      await call(`/rooms/${code}/leave`, { method: "POST", token: owner.token });
    }
  }
});

test("CPU single-card offers stay public for about five seconds before Worker acceptance", async () => {
  let observed = false;
  // Real shuffled rooms: no private Worker-state injection is needed. Repeated
  // exchanges usually produce two-pair hands, whose CPU strategy discards one.
  for (let attempt = 0; attempt < 12 && !observed; attempt++) {
    const owner = await call("/rooms", { method: "POST", body: { name: "Offer observer" } });
    const code = owner.view.roomCode;
    try {
      for (let i = 0; i < 3; i++) await call(`/rooms/${code}/command`, { method: "POST", token: owner.token, body: { type: "add-bot" } });
      let result = await call(`/rooms/${code}/command`, { method: "POST", token: owner.token, body: { type: "start-round" }, settleBots: false });
      for (let exchange = 0; exchange < 3 && !observed && result.view.tableStage === "exchange"; exchange++) {
        const began = Date.now();
        result = await call(`/rooms/${code}/command`, { method: "POST", token: owner.token, body: { type: "exchange", discardIds: [] }, settleBots: false });
        if (result.view.pendingExchange) {
          const offer = result.view.pendingExchange;
          assert.equal(result.view.players.find(p => p.id === offer.playerId).control, "bot");
          assert.deepEqual(result.view.players.find(p => p.id === offer.playerId).hand, []);
          assert.equal("discardId" in offer, false);
          await new Promise(resolve => setTimeout(resolve, 4200));
          const still = (await call(`/rooms/${code}/state`, { token: owner.token })).view;
          assert.deepEqual(still.pendingExchange, offer);
          let ended = still;
          while (ended.pendingExchange?.playerId === offer.playerId && ended.pendingExchange?.card.id === offer.card.id) {
            assert.ok(Date.now() - began < 7500, "Worker should accept the offer shortly after five seconds");
            await new Promise(resolve => setTimeout(resolve, 100));
            ended = (await call(`/rooms/${code}/state`, { token: owner.token })).view;
          }
          assert.ok(Date.now() - began >= 4900);
          assert.equal(ended.exchangeEvents.filter(e => e.playerId === offer.playerId && e.singleCardChoice === "accepted").length, 1);
          observed = true;
        }
      }
    } finally { await call(`/rooms/${code}/leave`, { method: "POST", token: owner.token }); }
  }
  assert.ok(observed, "Expected at least one CPU single-card offer in twelve real rooms");
});
