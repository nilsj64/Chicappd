import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand, createRoom, viewForPlayer } from "../src/game.ts";
import { legalCards } from "../src/tricks.ts";

function humanRoom() {
  const owner = createRoom("Ada", "ABCDE", "human-a");
  return applyCommand(owner, { type: "add-human", actorId: "human-a", playerId: "human-b", name: "Bo" });
}

test("human identities are distinct and lobby commands respect ownership", () => {
  assert.notEqual(createRoom("Ada", "ABCDE").ownerId, createRoom("Bo", "ABCDE").ownerId);
  const room = humanRoom();
  assert.deepEqual(room.players.map((p) => [p.id, p.control]), [["human-a", "human"], ["human-b", "human"]]);
  assert.strictEqual(applyCommand(room, { type: "add-human", actorId: "human-b", playerId: "human-c", name: "Cy" }), room);
  assert.strictEqual(applyCommand(room, { type: "add-human", actorId: "human-a", playerId: "human-b", name: "Duplicate" }), room);
  assert.strictEqual(applyCommand(room, { type: "start-round", actorId: "human-b" }), room);
  assert.equal(applyCommand(room, { type: "remove-player", actorId: "human-b", playerId: "human-b" }).players.length, 1);
  assert.equal(applyCommand(room, { type: "remove-player", actorId: "human-a", playerId: "human-a" }).ownerId, "human-b");
});

test("player views conceal other hands, deck order, discard identities, and pending evaluations", () => {
  let game = applyCommand(humanRoom(), { type: "start-round", actorId: "human-a" });
  const a = viewForPlayer(game, "human-a");
  const b = viewForPlayer(game, "human-b");
  assert.equal(viewForPlayer(game, "stranger"), null);
  assert.deepEqual(a.players[1].hand, []);
  assert.deepEqual(b.players[0].hand, []);
  assert.equal(a.players[1].handCount, 5);
  assert.equal(b.players[0].handCount, 5);
  assert.deepEqual(a.players[0].hand, game.players[0].hand);
  assert.deepEqual(b.players[1].hand, game.players[1].hand);
  for (const view of [a, b]) {
    assert.equal(Object.hasOwn(view, "deck"), false);
    assert.equal(Object.hasOwn(view, "discard"), false);
    assert.equal(Object.hasOwn(view, "finalHands"), false);
    assert.equal(Object.hasOwn(view, "selectedCardIds"), true);
  }
  assert.equal(JSON.stringify(a).includes(game.players[1].hand[0].id), false);
  assert.equal(JSON.stringify(a).includes(game.deck[0].id), false);
  game = applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [] });
  game = applyCommand(game, { type: "exchange", actorId: "human-b", discardIds: [] });
  assert.deepEqual(viewForPlayer(game, "human-a").handAwards[0].evaluations, {});
});

test("human exchanges wait for every human and reject duplicates or invalid cards", () => {
  let game = applyCommand(humanRoom(), { type: "start-round", actorId: "human-a" });
  const beforeB = game.players[1].hand;
  assert.strictEqual(applyCommand(game, { type: "exchange", actorId: "stranger", discardIds: [] }), game);
  assert.strictEqual(applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [beforeB[0].id] }), game);
  game = applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [game.players[0].hand[0].id] });
  assert.equal(game.exchangeCount, 0);
  assert.deepEqual(game.exchangeSubmittedPlayerIds, ["human-a"]);
  assert.deepEqual(game.players[1].hand, beforeB);
  assert.strictEqual(applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [] }), game);
  game = applyCommand(game, { type: "exchange", actorId: "human-b", discardIds: [] });
  assert.equal(game.exchangeCount, 1);
  assert.deepEqual(game.exchangeSubmittedPlayerIds, []);
  assert.equal(game.handAwards.length, 1);
});

test("turn and shared progression commands require the right human or owner", () => {
  let game = applyCommand(humanRoom(), { type: "start-round", actorId: "human-a" });
  for (let round = 0; round < 3; round++) {
    game = applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [] });
    game = applyCommand(game, { type: "exchange", actorId: "human-b", discardIds: [] });
  }
  assert.equal(game.tableStage, "tricks");
  assert.equal(game.activePlayerId, "human-a");
  assert.strictEqual(applyCommand(game, { type: "play-card", actorId: "human-b", cardId: game.players[1].hand[0].id }), game);
  assert.strictEqual(applyCommand(game, { type: "advance-bot", actorId: "human-b" }), game);
  game = applyCommand(game, { type: "play-card", actorId: "human-a", cardId: game.players[0].hand[0].id });
  assert.equal(game.activePlayerId, "human-b");
  assert.equal(game.currentTrick.length, 1);
  assert.strictEqual(applyCommand(game, { type: "play-card", actorId: "human-a", cardId: game.players[0].hand[0].id }), game);
  assert.strictEqual(applyCommand(game, { type: "continue-trick", actorId: "human-b" }), game);
});

test("authoritative commands complete five tricks and preserve scoring", () => {
  let game = applyCommand(humanRoom(), { type: "start-round", actorId: "human-a" });
  for (let exchange = 0; exchange < 3; exchange++) {
    game = applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [] });
    game = applyCommand(game, { type: "exchange", actorId: "human-b", discardIds: [] });
  }
  for (let play = 0; play < 10; play++) {
    const actorId = game.activePlayerId;
    const actor = game.players.find((p) => p.id === actorId);
    const card = legalCards(actor.hand, game.currentTrick[0]?.card.suit ?? null)[0];
    game = applyCommand(game, { type: "play-card", actorId, cardId: card.id });
    if (game.waitingForNextTrick)
      game = applyCommand(game, { type: "continue-trick", actorId: "human-a" });
  }
  assert.equal(game.tableStage, "result");
  assert.equal(game.completedTricks.length, 5);
  assert.equal(game.handAwards.length, 3);
  assert.equal(game.finalTrickAward.points, 5);
  assert.equal(game.players.reduce((sum, p) => sum + p.score, 0),
    game.handAwards.reduce((sum, award) => sum + award.points, 0) + 5);
});
