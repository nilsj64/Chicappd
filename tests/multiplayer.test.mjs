import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand, createRoom, viewForPlayer } from "../src/game.ts";
import { legalCards } from "../src/tricks.ts";
import { matchStandings, matchWinnerId } from "../src/scoring.ts";

function humanRoom() {
  const owner = createRoom("Ada", "ABCDE", "human-a");
  return applyCommand(owner, { type: "add-human", actorId: "human-a", playerId: "human-b", name: "Bo" });
}

function settleBotOffers(game) {
  for (let i = 0; i < 12 && game.pendingExchange; i++)
    game = applyCommand(game, { type: "advance-bot", actorId: game.ownerId });
  return game;
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

test("ordinary rooms accept owner-managed bots alongside humans up to four seats", () => {
  let game = humanRoom();
  assert.strictEqual(applyCommand(game, { type: "add-bot", actorId: "human-b" }), game);
  game = applyCommand(game, { type: "add-bot", actorId: "human-a" });
  game = applyCommand(game, { type: "add-bot", actorId: "human-a" });
  assert.deepEqual(game.players.map((player) => player.control), ["human", "human", "bot", "bot"]);
  assert.strictEqual(applyCommand(game, { type: "add-bot", actorId: "human-a" }), game);
  assert.strictEqual(applyCommand(game, { type: "remove-player", actorId: "human-b", playerId: game.players[2].id }), game);
  game = applyCommand(game, { type: "remove-player", actorId: "human-a", playerId: game.players[2].id });
  assert.deepEqual(game.players.map((player) => player.control), ["human", "human", "bot"]);
  assert.equal(applyCommand(game, { type: "start-round", actorId: "human-a" }).players.length, 3);

  let solo = createRoom("Ada", "ABCDE", "human-a");
  solo = applyCommand(solo, { type: "add-bot", actorId: "human-a" });
  assert.equal(applyCommand(solo, { type: "start-round", actorId: "human-a" }).players.length, 2);
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
  assert.equal(game.pendingExchange.playerId, "human-a");
  game = applyCommand(game, { type: "exchange-choice", actorId: "human-a", accept: true });
  assert.equal(game.exchangeCount, 0);
  assert.deepEqual(game.exchangeSubmittedPlayerIds, ["human-a"]);
  assert.deepEqual(game.players[1].hand, beforeB);
  assert.strictEqual(applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [] }), game);
  game = applyCommand(game, { type: "exchange", actorId: "human-b", discardIds: [] });
  assert.equal(game.exchangeCount, 1);
  assert.deepEqual(game.exchangeSubmittedPlayerIds, []);
  assert.equal(game.handAwards.length, 1);
});

for (const accept of [true, false]) {
  test(`single-card exchange shows the first card to everyone, then ${accept ? "accepts it" : "deals a hidden replacement"}`, () => {
    let game = applyCommand(humanRoom(), { type: "start-round", actorId: "human-a" });
    const discarded = game.players[0].hand[0];
    const shown = game.deck[0];
    const reserve = game.deck[1];
    game = applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [discarded.id] });
    assert.equal(game.pendingExchange.card.id, shown.id);
    assert.deepEqual(game.players[0].hand.map((card) => card.id).includes(discarded.id), true);
    assert.equal(game.exchangeEvents.length, 0);
    assert.equal(game.activePlayerId, "human-a");
    for (const viewer of ["human-a", "human-b"]) {
      const view = viewForPlayer(game, viewer);
      assert.equal(view.pendingExchange.card.id, shown.id);
      assert.equal(JSON.stringify(view).includes(reserve.id), false);
      assert.equal(view.players.find((player) => player.id !== viewer).hand.length, 0);
      assert.equal("discardId" in view.pendingExchange, false);
    }
    assert.strictEqual(applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [] }), game);
    assert.strictEqual(applyCommand(game, { type: "exchange-choice", actorId: "human-b", accept }), game);
    game = applyCommand(game, { type: "exchange-choice", actorId: "human-a", accept });
    assert.equal(game.pendingExchange, null);
    assert.equal(game.activePlayerId, "human-b");
    assert.equal(game.exchangeEvents.length, 1);
    assert.ok(game.discard.some((card) => card.id === discarded.id));
    assert.equal(game.players[0].hand.some((card) => card.id === (accept ? shown.id : reserve.id)), true);
    assert.equal(game.players[0].hand.some((card) => card.id === (accept ? reserve.id : shown.id)), false);
    assert.equal(game.discard.some((card) => card.id === shown.id), !accept);
    assert.strictEqual(applyCommand(game, { type: "exchange-choice", actorId: "human-a", accept: true }), game);
    assert.equal(JSON.stringify(viewForPlayer(game, "human-b")).includes(reserve.id), false);
  });
}

test("exchange events follow seat order and scoring closes each exchange before the next", () => {
  let game = applyCommand(humanRoom(), { type: "add-bot", actorId: "human-a" });
  game = applyCommand(game, { type: "start-round", actorId: "human-a" });
  assert.strictEqual(applyCommand(game, { type: "exchange", actorId: "human-b", discardIds: [] }), game);
  const hiddenCard = game.players[0].hand[0].id;
  game = applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [hiddenCard] });
  assert.equal(game.pendingExchange.card.id, game.deck[0].id);
  game = applyCommand(game, { type: "exchange-choice", actorId: "human-a", accept: true });
  assert.deepEqual(game.exchangeEvents.map((event) => event.playerId), ["human-a"]);
  game = applyCommand(game, { type: "exchange", actorId: "human-b", discardIds: [] });
  game = settleBotOffers(game);
  assert.deepEqual(game.exchangeEvents.map((event) => event.playerId), ["human-a", "human-b", "demo-1"]);
  assert.deepEqual(game.exchangeEvents.map((event) => event.id), [1, 2, 3]);
  assert.equal(game.exchangeCount, 1);
  assert.match(game.activity.at(-1), /efter byte 1/);
  assert.deepEqual(game.activity.slice(0, 3).map((message) => message.slice(0, 7)),
    ["Byte 1:", "Byte 1:", "Byte 1:"]);
  const publicView = viewForPlayer(game, "human-b");
  assert.deepEqual(publicView.exchangeEvents, game.exchangeEvents);
  assert.equal(JSON.stringify(publicView.exchangeEvents).includes(hiddenCard), false);
  game = applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [] });
  assert.match(game.activity.at(-1), /^Byte 2:/);
  assert.match(game.activity.at(-2), /efter byte 1/);
});

test("round starter rotates and wraps through four human seats; trick winners lead next", () => {
  let game = humanRoom();
  game = applyCommand(game, { type: "add-human", actorId: "human-a", playerId: "human-c", name: "Cy" });
  game = applyCommand(game, { type: "add-human", actorId: "human-a", playerId: "human-d", name: "Dee" });
  for (const starterId of ["human-a", "human-b", "human-c", "human-d", "human-a"]) {
    game = applyCommand(game, { type: "start-round", actorId: "human-a" });
    assert.equal(game.roundStarterId, starterId);
    assert.equal(game.activePlayerId, starterId);
    for (let exchange = 0; exchange < 3; exchange++) {
      assert.strictEqual(applyCommand(game, { type: "exchange", actorId: game.players.find((p) => p.id !== starterId).id,
        discardIds: [] }), game);
      for (let seat = 0; seat < 4; seat++)
        game = applyCommand(game, { type: "exchange", actorId: game.activePlayerId, discardIds: [] });
      assert.equal(game.exchangeCount, exchange + 1);
    }
    assert.equal(game.activePlayerId, starterId);
    while (game.tableStage !== "result") {
      const actor = game.players.find((p) => p.id === game.activePlayerId);
      const card = legalCards(actor.hand, game.currentTrick[0]?.card.suit ?? null)[0];
      game = applyCommand(game, { type: "play-card", actorId: actor.id, cardId: card.id });
      if (game.waitingForNextTrick) {
        assert.equal(game.activePlayerId, game.completedTricks.at(-1).winnerId);
        game = applyCommand(game, { type: "continue-trick", actorId: "human-a" });
      }
    }
  }
});

test("bot starter and bot exchanges are shared public events in clockwise order", () => {
  let game = createRoom("Ada", "ABCDE", "human-a");
  for (let i = 0; i < 3; i++) game = applyCommand(game, { type: "add-bot", actorId: "human-a" });
  game = applyCommand(game, { type: "start-round", actorId: "human-a" });
  for (let exchange = 0; exchange < 3; exchange++)
    game = settleBotOffers(applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [] }));
  while (game.tableStage !== "result") {
    const actor = game.players.find((p) => p.id === game.activePlayerId);
    game = applyCommand(game, { type: "advance-bot", actorId: "human-a" });
    if (actor.control === "human") {
      const card = legalCards(actor.hand, game.currentTrick[0]?.card.suit ?? null)[0];
      game = applyCommand(game, { type: "play-card", actorId: actor.id, cardId: card.id });
    }
    if (game.waitingForNextTrick)
      game = applyCommand(game, { type: "continue-trick", actorId: "human-a" });
  }
  game = settleBotOffers(applyCommand(game, { type: "start-round", actorId: "human-a" }));
  assert.equal(game.roundStarterId, "demo-1");
  assert.deepEqual(game.exchangeEvents.map((event) => event.playerId), ["demo-1", "demo-2", "demo-3"]);
  assert.equal(game.activePlayerId, "human-a");
  game = settleBotOffers(applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [] }));
  assert.deepEqual(game.exchangeEvents.slice(0, 4).map((event) => event.playerId),
    ["demo-1", "demo-2", "demo-3", "human-a"]);
  assert.match(game.activity.at(4), /efter byte 1/);
  for (let exchange = 0; exchange < 2; exchange++)
    game = settleBotOffers(applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [] }));
  assert.equal(game.tableStage, "tricks");
  assert.equal(game.activePlayerId, "demo-1");
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

test("returning to lobby clears every round field while keeping players, scores and rules", () => {
  for (const stage of ["exchange", "tricks", "result"]) {
    let game = applyCommand(humanRoom(), { type: "start-round", actorId: "human-a" });
    if (stage !== "exchange") {
      for (let exchange = 0; exchange < 3; exchange++) {
        game = applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [] });
        game = applyCommand(game, { type: "exchange", actorId: "human-b", discardIds: [] });
      }
    }
    if (stage === "result") {
      while (game.tableStage !== "result") {
        const actor = game.players.find((p) => p.id === game.activePlayerId);
        const card = legalCards(actor.hand, game.currentTrick[0]?.card.suit ?? null)[0];
        game = applyCommand(game, { type: "play-card", actorId: actor.id, cardId: card.id });
        if (game.waitingForNextTrick)
          game = applyCommand(game, { type: "continue-trick", actorId: "human-a" });
      }
    }
    const scores = game.players.map((p) => p.score);
    assert.strictEqual(applyCommand(game, { type: "return-lobby", actorId: "human-b" }), game);
    const lobby = applyCommand(game, { type: "return-lobby", actorId: "human-a" });
    assert.equal(lobby.phase, "lobby");
    assert.equal(lobby.tableStage, "exchange");
    assert.deepEqual(lobby.players.map((p) => p.score), scores);
    assert.deepEqual(viewForPlayer(lobby, "human-a").players.map((p) => p.score), scores);
    assert.ok(lobby.players.every((p) => p.hand.length === 0));
    assert.equal(lobby.deck.length, 52);
    assert.equal(lobby.discard.length, 0);
    assert.equal(lobby.exchangeCount, 0);
    assert.deepEqual(lobby.handAwards, []);
    assert.deepEqual(lobby.currentTrick, []);
    assert.deepEqual(lobby.completedTricks, []);
    assert.deepEqual(lobby.activity, []);
    assert.equal(lobby.finalHands, null);
    assert.equal(lobby.finalTrickAward, null);
    assert.equal(lobby.waitingForNextTrick, false);
    assert.equal(lobby.activePlayerId, null);
    assert.equal(applyCommand(lobby, { type: "start-round", actorId: "human-a" }).phase, "table");
  }
});

test("leaving an active room removes the player and returns remaining players to a clean lobby", () => {
  let game = applyCommand(humanRoom(), { type: "start-round", actorId: "human-a" });
  game = applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [] });
  assert.deepEqual(game.exchangeSubmittedPlayerIds, ["human-a"]);
  game = applyCommand(game, { type: "remove-player", actorId: "human-a", playerId: "human-a" });
  assert.equal(game.phase, "lobby");
  assert.equal(game.ownerId, "human-b");
  assert.deepEqual(game.players.map((p) => p.id), ["human-b"]);
  assert.equal(game.players[0].hand.length, 0);
  assert.deepEqual(game.exchangeSubmittedPlayerIds, []);
  assert.equal(viewForPlayer(game, "human-a"), null);
  assert.equal(applyCommand(game, { type: "add-human", actorId: "human-b", playerId: "human-c", name: "Cy" }).players.length, 2);
});

test("hand awards name only the category and keep early evaluations private", () => {
  let game = applyCommand(humanRoom(), { type: "start-round", actorId: "human-a" });
  for (let exchange = 0; exchange < 2; exchange++) {
    game = applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [] });
    game = applyCommand(game, { type: "exchange", actorId: "human-b", discardIds: [] });
    assert.deepEqual(viewForPlayer(game, "human-a").players.map((p) => p.score),
      game.players.map((p) => p.score));
    assert.ok(game.activity.some((event) => /hade bästa hand \([^)]+\) och fick \d+ poäng|Ingen fick poäng/.test(event)));
    assert.ok(game.activity.every((event) => !/jämförelse:|ess|kungar|damer|knektar/.test(event)));
    assert.deepEqual(viewForPlayer(game, "human-a").handAwards.at(-1).evaluations, {});
  }
  game = applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [] });
  game = applyCommand(game, { type: "exchange", actorId: "human-b", discardIds: [] });
  while (game.tableStage !== "result") {
    const actor = game.players.find((p) => p.id === game.activePlayerId);
    const card = legalCards(actor.hand, game.currentTrick[0]?.card.suit ?? null)[0];
    game = applyCommand(game, { type: "play-card", actorId: actor.id, cardId: card.id });
    if (game.waitingForNextTrick)
      game = applyCommand(game, { type: "continue-trick", actorId: "human-a" });
  }
  assert.ok(Object.keys(viewForPlayer(game, "human-a").handAwards.at(-1).evaluations).length === 2);
  if (game.handAwards.at(-1).winnerId) {
    const award = game.handAwards.at(-1);
    assert.match(game.activity.at(-1), /hade bästa hand \([^)]+\) och fick \d+ poäng/);
    assert.ok(!game.activity.at(-1).includes(award.evaluations[award.winnerId].label));
  }
});

test("46 points blocks card changes but keeping a hand still advances the exchange", () => {
  let game = applyCommand(humanRoom(), { type: "start-round", actorId: "human-a" });
  game = { ...game, players: game.players.map((player) => player.id === "human-a" ? { ...player, score: 45 } : player) };
  const twoCards = game.players[0].hand.slice(0, 2).map((card) => card.id);
  const changed = applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: twoCards });
  assert.notStrictEqual(changed, game);
  assert.equal(changed.exchangeEvents[0].changedCards, 2);

  game = { ...game, players: game.players.map((player) => player.id === "human-a" ? { ...player, score: 46 } : player) };
  assert.strictEqual(applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: twoCards }), game);
  const kept = applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [] });
  assert.equal(kept.exchangeEvents[0].changedCards, 0);
  assert.deepEqual(kept.players[0].hand, game.players[0].hand);
  assert.strictEqual(applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [twoCards[0]] }), game);
});

test("a CPU at 46 keeps its hand and the room continues", () => {
  let game = applyCommand(createRoom("Ada", "ABCDE", "human-a"), { type: "add-bot", actorId: "human-a" });
  game = applyCommand(game, { type: "start-round", actorId: "human-a" });
  game = { ...game, players: game.players.map((player) => player.control === "bot"
    ? { ...player, score: 46 } : player) };
  const botHand = game.players[1].hand;
  game = applyCommand(game, { type: "exchange", actorId: "human-a", discardIds: [] });
  assert.equal(game.exchangeCount, 1);
  assert.deepEqual(game.exchangeEvents.map((event) => event.changedCards), [0, 0]);
  assert.deepEqual(game.players[1].hand, botHand);
});

test("only a player with a past Chicago declaration can finish at 52", () => {
  const room = humanRoom();
  const scored = { ...room, players: room.players.map((player) => player.id === "human-a"
    ? { ...player, score: 52 } : player) };
  assert.equal(matchWinnerId(scored.players), null);
  assert.notStrictEqual(applyCommand(scored, { type: "start-round", actorId: "human-a" }), scored);
  const declared = { ...scored, players: scored.players.map((player) => player.id === "human-a"
    ? { ...player, hasDeclaredChicago: true } : player) };
  assert.equal(matchWinnerId(declared.players), "human-a");
  assert.strictEqual(applyCommand(declared, { type: "start-round", actorId: "human-a" }), declared);
  assert.deepEqual(matchStandings([{ id: "b", score: 50 }, { id: "a", score: 52 }, { id: "c", score: 40 }], "a")
    .map((player) => player.id), ["a", "b", "c"]);
});
