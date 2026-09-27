import test from "node:test";
import assert from "node:assert/strict";
import { createRoom, startRound, viewForPlayer } from "../src/game.ts";
import { supportAdvice } from "../src/support.ts";
import { legalCards } from "../src/tricks.ts";

const card = (rank, suit) => ({ id: `${suit}-${rank}`, rank, suit });
const hand = (...items) => items.map(([rank, suit]) => card(rank, suit));
const S = "spades", H = "hearts", D = "diamonds", C = "clubs";

function gameWithHand(cards) {
  const room = createRoom("Du", "ABCDE", "local");
  room.players.push({ id: "other", name: "Alex", control: "bot", score: 0, hand: [] });
  const game = startRound(room);
  game.players[0].hand = cards;
  return game;
}

test("exchange advice follows the current hand and reuses hand evaluation", () => {
  const game = gameWithHand(hand(["Q", S], ["Q", H], ["9", D], ["6", C], ["3", S]));
  const paired = supportAdvice(viewForPlayer(game, "local"), "local");
  assert.deepEqual(paired.tips[0].cardIds, ["spades-Q", "hearts-Q"]);
  assert.match(paired.tips[0].text, /Ett par/);
  assert.deepEqual(new Set(paired.tips[1].cardIds), new Set(["diamonds-9", "clubs-6", "spades-3"]));

  game.players[0].hand = hand(["A", H], ["J", H], ["9", H], ["6", H], ["3", H]);
  const flush = supportAdvice(viewForPlayer(game, "local"), "local");
  assert.equal(flush.tips.length, 1);
  assert.deepEqual(flush.tips[0].cardIds, game.players[0].hand.map((held) => held.id));

  game.exchangeSubmittedPlayerIds = ["local"];
  const waiting = supportAdvice(viewForPlayer(game, "local"), "local");
  assert.deepEqual(waiting.tips, []);
  assert.match(waiting.context, /vänta på övriga/);
});

test("trick advice changes with the lead and recommends only legal cards", () => {
  const game = gameWithHand(hand(["A", S], ["3", S], ["9", H], ["5", D], ["K", C]));
  game.tableStage = "tricks";
  game.activePlayerId = "local";
  const lead = supportAdvice(viewForPlayer(game, "local"), "local");
  assert.equal(lead.tips[0].cardIds[0], "spades-3");

  game.currentTrick = [{ playerId: "other", card: card("10", S) }];
  game.completedTricks = Array.from({ length: 4 }, () => ({ cards: [], winnerId: "other" }));
  const finalTrick = supportAdvice(viewForPlayer(game, "local"), "local");
  assert.equal(finalTrick.tips[0].cardIds[0], "spades-A");
  assert.match(finalTrick.tips[0].text, /säkrar 5 poäng/);
  const legalIds = new Set(legalCards(game.players[0].hand, S).map((held) => held.id));
  for (const tip of finalTrick.tips) for (const id of tip.cardIds) assert.ok(legalIds.has(id));
  assert.match(finalTrick.context, /5 poäng/);

  game.currentTrick = [{ playerId: "other", card: card("10", H) }];
  const hearts = supportAdvice(viewForPlayer(game, "local"), "local");
  assert.deepEqual(hearts.tips.map((tip) => tip.cardIds[0]), ["hearts-9"]);
});

test("a possible winner is described as uncertain while another player remains", () => {
  const game = gameWithHand(hand(["A", S], ["3", S], ["9", H], ["5", D], ["K", C]));
  game.players.push({ id: "third", name: "Sam", control: "bot", score: 0, hand: [] });
  game.tableStage = "tricks";
  game.activePlayerId = "local";
  game.completedTricks = Array.from({ length: 4 }, () => ({ cards: [], winnerId: "other" }));
  game.currentTrick = [{ playerId: "other", card: card("10", S) }];
  const advice = supportAdvice(viewForPlayer(game, "local"), "local");
  assert.equal(advice.tips[0].cardIds[0], "spades-A");
  assert.match(advice.tips[0].text, /kan fortfarande slå/);
  assert.doesNotMatch(advice.tips[0].text, /säkrar/);
  assert.deepEqual(advice.tips[1].cardIds, ["spades-3"]);
});

test("when void in the led suit, advice stays within the legal hand", () => {
  const game = gameWithHand(hand(["A", S], ["3", S], ["9", H], ["5", D], ["K", C]));
  game.tableStage = "tricks";
  game.activePlayerId = "local";
  game.currentTrick = [{ playerId: "other", card: card("10", C) }];
  game.players[0].hand = hand(["A", S], ["3", S], ["9", H], ["5", D], ["2", D]);
  const advice = supportAdvice(viewForPlayer(game, "local"), "local");
  assert.deepEqual(advice.tips[0].cardIds, ["diamonds-2"]);
  assert.match(advice.tips[0].text, /kan inte följa färg/);
  assert.deepEqual(advice.tips.flatMap((tip) => tip.cardIds).every((id) =>
    game.players[0].hand.some((held) => held.id === id)), true);
});

test("advice is independent of hidden opponent cards and deck", () => {
  const game = gameWithHand(hand(["A", S], ["3", S], ["9", H], ["5", D], ["K", C]));
  game.tableStage = "tricks";
  game.activePlayerId = "local";
  game.currentTrick = [{ playerId: "other", card: card("10", S) }];
  const firstView = viewForPlayer(game, "local");
  const first = supportAdvice(firstView, "local");
  game.players[1].hand = hand(["A", H], ["K", H], ["Q", H], ["J", H], ["2", H]);
  game.deck.reverse();
  const secondView = viewForPlayer(game, "local");
  assert.deepEqual(secondView.players[1].hand, []);
  assert.deepEqual(supportAdvice(secondView, "local"), first);
  assert.equal("deck" in firstView, false);
  assert.deepEqual(supportAdvice(firstView, "missing"), { context: "", tips: [] });
});
