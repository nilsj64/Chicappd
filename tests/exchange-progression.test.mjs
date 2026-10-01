import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand, needsTimedBotExchange, CPU_REVEAL_MS, viewForPlayer } from "../src/game.ts";
import { lockedHumanRoom } from "./exchange-fixture.mjs";

for (const cpuCount of [1, 2]) test(`locked human waits for ${cpuCount} CPUs through every exchange and five-second reveal`, t => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  let game = applyCommand(lockedHumanRoom(t, cpuCount), { type: "start-round", actorId: "ada" });
  const humanHand = game.players[0].hand;
  assert.equal(game.tableStage, "exchange");
  assert.deepEqual(game.exchangeSubmittedPlayerIds, ["ada"]);
  assert.equal(game.activePlayerId, "demo-1");
  assert.equal(game.exchangeCount, 0);
  for (let pass = 0; pass < 3; pass++) {
    for (let cpu = 1; cpu <= cpuCount; cpu++) {
      assert.equal(game.tableStage, "exchange");
      assert.equal(game.activePlayerId, `demo-${cpu}`);
      assert.equal(needsTimedBotExchange(game), true);
      const completed = game.exchangeEvents.filter(e => e.playerId !== "ada").length;
      game = applyCommand(game, { type: "advance-bot", actorId: "ada" });
      assert.equal(game.pendingExchange.playerId, `demo-${cpu}`);
      assert.equal(game.pendingExchange.revealUntil, now + CPU_REVEAL_MS);
      const offer = game.pendingExchange.card;
      assert.deepEqual(viewForPlayer(game, "ada").players[cpu].hand, []);
      assert.deepEqual(viewForPlayer(game, "ada").pendingExchange, { playerId: `demo-${cpu}`, card: offer });
      // A saved/resumed state retains both the phase and authority deadline.
      game = JSON.parse(JSON.stringify(game));
      now += CPU_REVEAL_MS - 1;
      assert.strictEqual(applyCommand(game, { type: "advance-bot", actorId: "ada" }), game);
      assert.equal(game.tableStage, "exchange");
      assert.equal(game.exchangeCount, pass);
      now++;
      game = applyCommand(game, { type: "advance-bot", actorId: "ada" });
      assert.equal(game.pendingExchange, null);
      assert.equal(game.exchangeEvents.filter(e => e.playerId !== "ada").length, completed + 1);
      assert.ok(game.players[cpu].hand.some(c => c.id === offer.id));
      assert.deepEqual(game.players[0].hand, humanHand);
      assert.equal(game.tableStage, pass === 2 && cpu === cpuCount ? "tricks" : "exchange");
    }
    assert.equal(game.exchangeCount, pass + 1);
  }
  assert.equal(game.handAwards.length, 2);
  assert.equal(game.exchangeEvents.length, (cpuCount + 1) * 3);
  assert.equal(game.activePlayerId, "ada");
  assert.equal(game.completedTricks.length, 0);
});

test("CPU exchanges without offers also publish one decision at a time", t => {
  let game = applyCommand(lockedHumanRoom(t), { type: "start-round", actorId: "ada" });
  // The flush is kept, so no pending offer can interrupt a synchronous loop.
  const [human, bot] = game.players;
  game = { ...game, players: [{ ...human, hand: bot.hand }, { ...bot, hand: human.hand }] };
  for (let pass = 0; pass < 3; pass++) {
    game = applyCommand(game, { type: "advance-bot", actorId: "ada" });
    assert.equal(game.exchangeCount, pass + 1);
    assert.equal(game.exchangeEvents.filter(e => e.playerId === bot.id).length, pass + 1);
    assert.equal(game.pendingExchange, null);
    assert.equal(game.tableStage, pass === 2 ? "tricks" : "exchange");
  }
});
