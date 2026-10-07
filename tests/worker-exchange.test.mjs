import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { CPU_EXCHANGE_PAUSE_MS, CPU_REVEAL_MS } from "../src/game.ts";
import { lockedHumanRoom } from "./exchange-fixture.mjs";

// Exercise the real request/alarm handlers with durable storage and clock
// doubles; Cloudflare supplies only the base class in this test transform.
const source = fs.readFileSync(new URL("../server/worker.ts", import.meta.url), "utf8")
  .replace('import { DurableObject } from "cloudflare:workers";', "class DurableObject { constructor(ctx) { this.ctx = ctx; } }")
  .replaceAll('"../src/game.ts"', JSON.stringify(new URL("../src/game.ts", import.meta.url).href));
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { GameRoom } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("Worker persists each locked-human CPU turn and resumes five-second offers through alarms", async t => {
  let now = 1000, alarmAt;
  t.mock.method(Date, "now", () => now);
  let saved = { game: lockedHumanRoom(t, 2), sessions: [{ playerId: "ada", token: "session" }], version: 0 };
  const updates = [];
  const ctx = { storage: {
    async get() { return structuredClone(saved); },
    async put(key, value) { assert.equal(key, "room"); saved = structuredClone(value); },
    async setAlarm(time) { alarmAt = time; },
  }, getWebSockets: () => [{ deserializeAttachment: () => "ada", send: value => updates.push(JSON.parse(value).view) }] };
  let worker = new GameRoom(ctx, {});
  const response = await worker.fetch(new Request("http://room/command", { method: "POST",
    headers: { authorization: "Bearer session", "content-type": "application/json" }, body: JSON.stringify({ type: "start-round" }) }));
  assert.equal(response.status, 200);
  const { view } = await response.json();
  assert.equal(view.tableStage, "exchange");
  assert.equal(view.activePlayerId, "demo-1");
  assert.equal(alarmAt, now + CPU_EXCHANGE_PAUSE_MS);
  const humanHand = saved.game.players[0].hand;
  for (let turn = 0; turn < 6; turn++) {
    now = alarmAt;
    // Reconstruct the Durable Object from its saved state before every turn.
    worker = new GameRoom(ctx, {});
    await worker.alarm();
    assert.equal(saved.game.tableStage, "exchange");
    assert.equal(saved.game.pendingExchange.playerId, `demo-${turn % 2 + 1}`);
    assert.equal(alarmAt, now + CPU_REVEAL_MS);
    assert.deepEqual(updates.at(-1).players[turn % 2 + 1].hand, []);
    const revision = saved.version;
    now = alarmAt - 1;
    await worker.alarm();
    assert.equal(saved.version, revision);
    assert.equal(saved.game.tableStage, "exchange");
    now++;
    worker = new GameRoom(ctx, {});
    await worker.alarm();
    assert.equal(saved.game.pendingExchange, null);
    assert.equal(saved.game.exchangeEvents.filter(e => e.playerId !== "ada").length, turn + 1);
    assert.deepEqual(saved.game.players[0].hand, humanHand);
    assert.equal(saved.game.tableStage, turn === 5 ? "tricks" : "exchange");
    if (turn < 5) assert.equal(alarmAt, now + CPU_EXCHANGE_PAUSE_MS);
  }
  assert.equal(saved.game.exchangeCount, 3);
  assert.equal(saved.game.completedTricks.length, 0);
  assert.equal(updates.length, 13);
});

test('Worker keeps the Chicago choice open across long delivery, stale alarms and restart until eligible humans decide', async t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const { createRoom, createDeck, applyCommand, startRound } = await import('../src/game.ts');
  let game = createRoom('Ada', 'ABCDE', 'ada');
  game = applyCommand(game, { type: 'add-human', actorId: 'ada', playerId: 'bea', name: 'Bea' });
  game = applyCommand(game, { type: 'add-bot', actorId: 'ada' });
  game = startRound(game);
  const deck = createDeck();
  game = { ...game, tableStage: 'tricks', exchangeCount: 3, roundStarterId: 'demo-1', activePlayerId: 'demo-1',
    chicagoPlayerId: null, chicagoPassedPlayerIds: [],
    players: game.players.map((player, i) => ({ ...player, score: player.control === 'human' ? 15 : 0,
      hand: deck.slice(i * 5, i * 5 + 5) })), deck: deck.slice(15), discard: [] };
  let saved = { game, sessions: [{ playerId: 'ada', token: 'a' }, { playerId: 'bea', token: 'b' }], version: 0 };
  const ctx = { storage: {
    async get() { return structuredClone(saved); },
    async put(key, value) { saved = structuredClone(value); },
    async setAlarm() { assert.fail('No countdown should close an unanswered Chicago choice'); },
  }, getWebSockets: () => [] };
  let worker = new GameRoom(ctx, {});
  now += 120000; // Delivery can take longer than the old five-second window.
  await worker.alarm();
  assert.equal(saved.game.currentTrick.length, 0);
  const command = async (token, type) => {
    const response = await worker.fetch(new Request('http://room/command', { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ type }) }));
    assert.equal(response.status, 200);
    return (await response.json()).view;
  };
  const passed = await command('a', 'pass-chicago');
  assert.deepEqual(passed.chicagoPassedPlayerIds, ['ada']);
  assert.equal(passed.currentTrick.length, 0); // Bea still needs her own choice.
  worker = new GameRoom(ctx, {});
  await worker.alarm();
  assert.equal(saved.game.currentTrick.length, 0);
  const started = await command('b', 'pass-chicago');
  assert.deepEqual(started.chicagoPassedPlayerIds, ['ada', 'bea']);
  assert.equal(started.currentTrick.length, 1);
  assert.equal(started.currentTrick[0].playerId, 'demo-1');
  assert.equal(started.activePlayerId, 'ada');
});
