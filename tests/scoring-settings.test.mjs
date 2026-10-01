import test from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, matchWinnerId, normalizeSettings, scoreAfterAward } from "../src/scoring.ts";
import { applyCommand, createDeck, createRoom, startRound, viewForPlayer } from "../src/game.ts";
import { createIRLGame, correctIRLScore, recordFirstHands, finishIRLDeal, nextIRLDeal } from "../src/irl.ts";

test("optional rules default off and old settings normalize, while room settings survive views and rounds", () => {
  assert.equal(defaultSettings.firstChicagoBreakBonus, false);
  assert.equal(defaultSettings.resetOver52WithoutChicago, false);
  const old = { finalTrickPoints: 2, allowNegativeScores: true };
  assert.deepEqual(normalizeSettings(old), { ...defaultSettings, ...old });
  let room = createRoom("Ada", "ABCDE", "ada");
  room = applyCommand(room, { type: "add-human", actorId: "ada", playerId: "bea", name: "Bea" });
  assert.deepEqual(room.settings, defaultSettings);
  assert.deepEqual(viewForPlayer({ ...room, settings: old }, "bea").settings, normalizeSettings(old));
  for (const key of ["firstChicagoBreakBonus", "resetOver52WithoutChicago"]) {
    assert.strictEqual(applyCommand(room, { type: "set-settings", actorId: "ada", settings: { ...defaultSettings, [key]: "yes" } }), room);
  }
  const settings = { ...defaultSettings, firstChicagoBreakBonus: true, resetOver52WithoutChicago: true };
  assert.strictEqual(applyCommand(room, { type: "set-settings", actorId: "bea", settings }), room);
  room = applyCommand(room, { type: "set-settings", actorId: "ada", settings });
  assert.deepEqual(viewForPlayer(room, "bea").settings, settings);
  room = startRound(room);
  assert.deepEqual(room.settings, settings);
  room = applyCommand(room, { type: "return-lobby", actorId: "ada" });
  assert.deepEqual(room.settings, settings);
  assert.deepEqual(createIRLGame(["Ada", "Bea"], settings).settings, settings);
});

for (const firstChicagoBreakBonus of [false, true]) {
  for (const resetOver52WithoutChicago of [false, true]) {
    const settings = { ...defaultSettings, firstChicagoBreakBonus, resetOver52WithoutChicago };
    test(`rule combination: Chicago break bonus=${firstChicagoBreakBonus}, reset=${resetOver52WithoutChicago}`, () => {
      for (const hasDeclaredChicago of [false, true]) {
        for (const score of [51, 52, 53]) {
          const player = { id: "ada", score, hasDeclaredChicago };
          assert.equal(matchWinnerId([player], settings), hasDeclaredChicago && score > 52 ? "ada" : null);
        }
        const at52 = scoreAfterAward({ score: 50, hasDeclaredChicago }, 2, settings);
        const over52 = scoreAfterAward({ score: 50, hasDeclaredChicago }, 3, settings);
        assert.equal(at52, 52);
        assert.equal(over52, resetOver52WithoutChicago && !hasDeclaredChicago ? 0 : 53);
        assert.equal(matchWinnerId([{ id: "ada", score: over52, hasDeclaredChicago }], settings), hasDeclaredChicago ? "ada" : null);
      }
      // An actual poker award uses the penalty before publishing the new total.
      let room = applyCommand(createRoom("Ada", "ABCDE", "ada"), { type: "add-human", actorId: "ada", playerId: "bea", name: "Bea" });
      let game = startRound({ ...room, settings });
      game.players = game.players.map((p, index) => ({ ...p, score: index ? 47 : 50,
        hand: (index ? ["2", "4", "6", "8", "10"] : ["10", "J", "Q", "K", "A"]).map(rank => ({ id: `${index ? "hearts" : "spades"}-${rank}`, rank, suit: index ? "hearts" : "spades" })) }));
      const held = new Set(game.players.flatMap(p => p.hand.map(c => c.id)));
      game.deck = createDeck().filter(c => !held.has(c.id));
      game = applyCommand(game, { type: "exchange", actorId: "ada", discardIds: [] });
      assert.equal(game.players[0].score, resetOver52WithoutChicago ? 0 : 66); // +8 in each of two early awards when no reset
      assert.equal(viewForPlayer(game, "bea").players[0].score, game.players[0].score);
      assert.equal(matchWinnerId(game.players, settings), null);
      // Physical scoring uses the same award rule, including multiple awards in one result.
      let physical = createIRLGame(["Ada", "Bea"], settings);
      physical = correctIRLScore(physical, "irl-1", 50);
      physical = recordFirstHands(physical, [{ playerId: "irl-1", category: "two-pair" }, null]);
      assert.equal(physical.players[0].score, 52);
      physical = finishIRLDeal(physical, { finalTrickWinnerId: "irl-1", finalHand: { playerId: "irl-1", category: "one-pair" } });
      assert.equal(physical.players[0].score, resetOver52WithoutChicago ? 1 : 58);
      assert.notStrictEqual(nextIRLDeal(physical), physical);
      assert.deepEqual(nextIRLDeal(physical).settings, settings);
    });
  }
}
