import test from "node:test";
import assert from "node:assert/strict";
import { createIRLGame, recordFirstHands, declareIRLChicago, finishIRLDeal, nextIRLDeal, correctIRLScore, undoIRL } from "../src/irl.ts";

const settings = { finalTrickPoints: 5, allowNegativeScores: false };
const players = ["Ada", "Bea", "Cia"];
const hand = (playerId, category) => ({ playerId, category });

test("physical match starts with named humans and no deck or AI", () => {
  const game = createIRLGame(players, settings);
  assert.deepEqual(game.players.map((player) => player.name), players);
  assert.equal(game.dealNumber, 1);
  assert.equal(game.phase, "hands");
  assert.equal("deck" in game, false);
  assert.ok(game.players.every((player) => !Object.hasOwn(player, "hand") && !Object.hasOwn(player, "control")));
});

test("physical deal scores both early hands, final hand and configured last trick", () => {
  let game = createIRLGame(players, settings);
  game = recordFirstHands(game, [hand("irl-1", "one-pair"), hand("irl-2", "two-pair")]);
  game = finishIRLDeal(game, { finalHand: hand("irl-3", "flush"), finalTrickWinnerId: "irl-1" });
  assert.deepEqual(game.players.map((p) => p.score), [6, 2, 5]);
  assert.ok(game.lastSummary.some((item) => /bästa hand \(ett par\)/.test(item)));
  assert.ok(game.lastSummary.some((item) => /Sista sticket: Ada \+5 enligt regeln för sista sticket/.test(item)));
  assert.ok(game.lastSummary.every((item) => !/ess|kungar|damer|knektar/.test(item)));
  assert.equal(game.phase, "result");
  assert.strictEqual(finishIRLDeal(game, { finalHand: null, finalTrickWinnerId: "irl-1" }), game);
  game = nextIRLDeal(game);
  assert.equal(game.phase, "hands");
  assert.equal(game.dealNumber, 2);
  assert.deepEqual(game.players.map((p) => p.score), [6, 2, 5]);
});

test("physical Chicago requires 15 and awards a win once", () => {
  let game = createIRLGame(players, settings);
  game = recordFirstHands(game, [null, null]);
  assert.strictEqual(declareIRLChicago(game, "irl-1"), game);
  game = correctIRLScore(game, "irl-1", 15);
  game = declareIRLChicago(game, "irl-1");
  assert.equal(game.chicagoPlayerId, "irl-1");
  assert.equal(game.players[0].hasDeclaredChicago, true);
  assert.strictEqual(declareIRLChicago(game, "irl-2"), game);
  game = finishIRLDeal(game, { finalHand: null, finalTrickWinnerId: "irl-1", chicagoWon: true });
  assert.deepEqual(game.players.map((p) => p.score), [35, 0, 0]);
});

test("first Chicago breaker gets 10 and negative setting controls floor", () => {
  for (const allowNegativeScores of [false, true]) {
    let game = createIRLGame(players, { finalTrickPoints: 2, allowNegativeScores });
    game = recordFirstHands(game, [null, null]);
    game = correctIRLScore(game, "irl-1", 15);
    game = declareIRLChicago(game, "irl-1");
    game = correctIRLScore(game, "irl-1", 8);
    assert.strictEqual(finishIRLDeal(game, { finalHand: null, finalTrickWinnerId: "irl-2", chicagoWon: false }), game);
    game = finishIRLDeal(game, { finalHand: null, finalTrickWinnerId: "irl-2", chicagoWon: false, breakerId: "irl-3" });
  assert.deepEqual(game.players.map((p) => p.score), [allowNegativeScores ? -7 : 0, 2, 10]);
    assert.equal(game.players[0].hasDeclaredChicago, true);
    assert.equal(game.lastSummary.filter((item) => item.startsWith("Bröt Chicago")).length, 1);
  }
});

test("physical match requires Chicago and more than 52 points to end", () => {
  let game = createIRLGame(players, settings);
  game = correctIRLScore(game, "irl-1", 52);
  game = recordFirstHands(game, [null, null]);
  game = finishIRLDeal(game, { finalHand: null, finalTrickWinnerId: "irl-2" });
  assert.notStrictEqual(nextIRLDeal(game), game);

  game = nextIRLDeal(game);
  game = recordFirstHands(game, [null, null]);
  game = declareIRLChicago(game, "irl-1");
  game = finishIRLDeal(game, { finalHand: null, finalTrickWinnerId: "irl-2", chicagoWon: false, breakerId: "irl-2" });
  assert.equal(game.players[0].hasDeclaredChicago, true);
  game = correctIRLScore(game, "irl-1", 52);
  assert.notStrictEqual(nextIRLDeal(game), game);
  game = correctIRLScore(game, "irl-1", 53);
  assert.strictEqual(nextIRLDeal(game), game);
});

test("manual score correction is undoable", () => {
  let game = createIRLGame(players, settings);
  game = correctIRLScore(game, "irl-2", 12);
  assert.equal(game.players[1].score, 12);
  game = undoIRL(game);
  assert.equal(game.players[1].score, 0);
  assert.strictEqual(correctIRLScore(game, "irl-2", -1), game);
});
