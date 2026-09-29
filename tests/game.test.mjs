import test from "node:test";
import assert from "node:assert/strict";
import {
  createRoom,
  addDemoPlayer,
  createDeck,
  startRound,
  toggleCard,
  exchangeSelectedCards,
  keepHand,
  selectTrickCard,
  playSelectedTrickCard,
  playSelectedTrickCardOnce,
  playTrickCardOnce,
  playNextDemoTrickCard,
  continueAfterTrick,
  continueAfterTrickOnce,
  playedCardsForPlayer,
  finalTrickPoints,
} from "../src/game.ts";
import { compareHands, evaluateHand, showdownHandLabel } from "../src/poker.ts";
import { chooseBotDiscards, chooseBotTrickCard } from "../src/bot.ts";
import { legalCards, trickWinner } from "../src/tricks.ts";

const card = (rank, suit) => ({ id: `${suit}-${rank}`, rank, suit });
const hand = (...cards) => cards.map(([rank, suit]) => card(rank, suit));
const S = "spades",
  H = "hearts",
  D = "diamonds",
  C = "clubs";

const examples = [
  ["high-card", hand(["A", S], ["J", H], ["9", D], ["6", C], ["3", S])],
  ["one-pair", hand(["Q", S], ["Q", H], ["9", D], ["6", C], ["3", S])],
  ["two-pair", hand(["J", S], ["J", H], ["8", D], ["8", C], ["3", S])],
  ["three-of-a-kind", hand(["K", S], ["K", H], ["K", D], ["6", C], ["3", S])],
  ["straight", hand(["9", S], ["8", H], ["7", D], ["6", C], ["5", S])],
  ["flush", hand(["A", H], ["J", H], ["9", H], ["6", H], ["3", H])],
  ["full-house", hand(["10", S], ["10", H], ["10", D], ["4", C], ["4", S])],
  ["four-of-a-kind", hand(["8", S], ["8", H], ["8", D], ["8", C], ["3", S])],
  ["straight-flush", hand(["9", H], ["8", H], ["7", H], ["6", H], ["5", H])],
];

test("showdown explains ranks only when players share a hand category", () => {
  const aces = evaluateHand(hand(["A", S], ["A", H], ["9", D], ["6", C], ["3", S]));
  const kings = evaluateHand(hand(["K", S], ["K", H], ["Q", D], ["6", C], ["3", S]));
  const flush = evaluateHand(hand(["A", H], ["J", H], ["9", H], ["6", H], ["3", H]));
  assert.equal(showdownHandLabel(aces, [aces, flush]), aces.label);
  assert.match(showdownHandLabel(aces, [aces, kings]), /jämförelse: ess, nio, sex, tre/);
  assert.ok(compareHands(aces, kings) > 0);
});

test("recognizes all nine categories in strength order", () => {
  for (const [category, cards] of examples)
    assert.equal(evaluateHand(cards).category, category);
  for (let i = 1; i < examples.length; i++) {
    assert.equal(
      compareHands(
        evaluateHand(examples[i][1]),
        evaluateHand(examples[i - 1][1]),
      ),
      1,
    );
  }
  assert.equal(evaluateHand(examples[1][1]).label, "Ett par – damer");
  assert.equal(
    evaluateHand(examples[2][1]).label,
    "Två par – knektar och åttor",
  );
  assert.equal(evaluateHand(examples[6][1]).label, "Kåk – tior över fyror");
});

test("breaks same-category ties in normal poker order", () => {
  const beats = [
    [
      hand(["A", S], ["K", H], ["9", D], ["6", C], ["3", S]),
      hand(["A", H], ["Q", S], ["9", C], ["6", D], ["3", H]),
    ],
    [
      hand(["Q", S], ["Q", H], ["A", D], ["8", C], ["3", S]),
      hand(["Q", D], ["Q", C], ["K", S], ["J", H], ["9", D]),
    ],
    [
      hand(["K", S], ["K", H], ["4", D], ["3", C], ["2", S]),
      hand(["Q", D], ["Q", C], ["A", S], ["J", H], ["9", D]),
    ],
    [
      hand(["J", S], ["J", H], ["8", D], ["8", C], ["A", S]),
      hand(["J", D], ["J", C], ["8", S], ["8", H], ["K", D]),
    ],
    [
      hand(["J", S], ["J", H], ["9", D], ["9", C], ["2", S]),
      hand(["J", D], ["J", C], ["8", S], ["8", H], ["A", D]),
    ],
    [
      hand(["K", S], ["K", H], ["K", D], ["A", C], ["3", S]),
      hand(["K", C], ["K", H], ["K", D], ["Q", S], ["J", H]),
    ],
    [
      hand(["A", S], ["A", H], ["A", D], ["2", C], ["3", S]),
      hand(["K", C], ["K", H], ["K", D], ["Q", S], ["J", H]),
    ],
    [
      hand(["6", S], ["5", H], ["4", D], ["3", C], ["2", S]),
      hand(["A", S], ["5", H], ["4", D], ["3", C], ["2", H]),
    ],
    [
      hand(["A", H], ["K", H], ["8", H], ["5", H], ["3", H]),
      hand(["A", D], ["Q", D], ["J", D], ["9", D], ["8", D]),
    ],
    [
      hand(["10", S], ["10", H], ["10", D], ["4", C], ["4", S]),
      hand(["9", S], ["9", H], ["9", D], ["A", C], ["A", S]),
    ],
    [
      hand(["8", S], ["8", H], ["8", D], ["8", C], ["A", S]),
      hand(["8", S], ["8", H], ["8", D], ["8", C], ["K", S]),
    ],
    [
      hand(["6", H], ["5", H], ["4", H], ["3", H], ["2", H]),
      hand(["A", D], ["5", D], ["4", D], ["3", D], ["2", D]),
    ],
    [
      hand(["7", H], ["6", H], ["5", H], ["4", H], ["3", H]),
      hand(["6", D], ["5", D], ["4", D], ["3", D], ["2", D]),
    ],
  ];
  for (const [winner, loser] of beats) {
    assert.equal(compareHands(evaluateHand(winner), evaluateHand(loser)), 1);
    assert.equal(compareHands(evaluateHand(loser), evaluateHand(winner)), -1);
  }
  const sameRanks = hand(["Q", D], ["Q", C], ["9", S], ["6", H], ["3", D]);
  assert.equal(
    compareHands(evaluateHand(examples[1][1]), evaluateHand(sameRanks)),
    0,
  );
  assert.throws(() =>
    evaluateHand(hand(["A", S], ["A", S], ["3", H], ["4", D], ["5", C])),
  );
  assert.throws(() =>
    evaluateHand([
      { ...card("A", S), id: "first" },
      { ...card("A", S), id: "second" },
      card("3", H),
      card("4", D),
      card("5", C),
    ]),
  );
});

function readyGame() {
  const room = createRoom("Du", "ABCDE", "local");
  room.players.push({
    id: "demo",
    name: "Alex",
    control: "bot",
    score: 0,
    hand: [],
  });
  return startRound(room);
}

function allCardIds(game) {
  return [
    ...game.deck,
    ...game.discard,
    ...game.players.flatMap((player) => player.hand),
    ...game.currentTrick.map((played) => played.card),
    ...game.completedTricks.flatMap((trick) => trick.cards.map((played) => played.card)),
  ].map((card) => card.id);
}

test("create, demo lobby, and table start remain available", () => {
  const room = createRoom("Du", "ABCDE", "local");
  assert.equal(room.phase, "lobby");
  assert.equal(startRound(room), room);
  const lobby = addDemoPlayer(room);
  assert.equal(lobby.players.length, 2);
  assert.equal(lobby.players[1].control, "bot");
  const table = startRound(lobby);
  assert.equal(table.phase, "table");
  assert.equal(table.exchangeCount, 0);
  assert.ok(table.players.every((player) => player.hand.length === 5));
  assert.equal(new Set(allCardIds(table)).size, 52);
  assert.ok(table.players.every((player) => player.score === 0));
  assert.deepEqual(table.handAwards, []);
});

for (const count of [1, 2, 3, 4, 5]) {
  test(`exchanges ${count} cards without duplication`, () => {
    let game = readyGame();
    const previousHand = game.players[0].hand.map((card) => card.id);
    const previousDeck = game.deck.length;
    for (const id of previousHand.slice(0, count)) game = toggleCard(game, id);
    game = exchangeSelectedCards(game);
    assert.equal(game.players[0].hand.length, 5);
    assert.ok(game.deck.length <= previousDeck - count);
    assert.ok(game.discard.length >= count);
    assert.deepEqual(
      game.discard.slice(0, count).map((card) => card.id),
      previousHand.slice(0, count),
    );
    assert.equal(game.selectedCardIds.length, 0);
    assert.equal(game.exchangeCount, 1);
    const ids = allCardIds(game);
    assert.equal(ids.length, 52);
    assert.equal(new Set(ids).size, 52);
  });
}

test("keeping all cards advances and exchange 3 enters trick play", () => {
  let game = readyGame();
  const firstHand = game.players[0].hand.map((card) => card.id);
  const deckCount = game.deck.length;
  game = keepHand(game);
  assert.deepEqual(
    game.players[0].hand.map((card) => card.id),
    firstHand,
  );
  assert.ok(game.deck.length <= deckCount);
  assert.equal(game.exchangeCount, 1);
  game = keepHand(game);
  game = keepHand(game);
  assert.equal(game.exchangeCount, 3);
  assert.equal(game.tableStage, "tricks");
  assert.equal(game.activePlayerId, "local");
  assert.strictEqual(toggleCard(game, firstHand[0]), game);
});

function readyTricks(opponents = 1) {
  let game = createRoom("Du", "ABCDE", "local");
  for (let i = 0; i < opponents; i++) game = addDemoPlayer(game);
  game = startRound(game);
  for (let i = 0; i < 3; i++) game = keepHand(game);
  assert.equal(game.tableStage, "tricks");
  return game;
}

test("direct card play uses the same legal transition and cannot repeat a turn", () => {
  const start = readyTricks();
  const chosen = start.players[0].hand[0];
  const selected = playSelectedTrickCardOnce(selectTrickCard(start, chosen.id));
  const direct = playTrickCardOnce(start, chosen.id);
  assert.deepEqual(direct, selected);
  assert.equal(direct.currentTrick.length, 1);
  assert.strictEqual(playTrickCardOnce(direct, chosen.id), direct);
  assert.strictEqual(playTrickCardOnce(start, "missing-card"), start);
});

test("one-step trick actions expose exactly the card chosen for each turn", () => {
  let game = readyTricks(3);
  const humanCard = game.players[0].hand[0];
  game = playSelectedTrickCardOnce(selectTrickCard(game, humanCard.id));
  assert.deepEqual(game.currentTrick.map(({ playerId, card }) => [playerId, card.id]), [["local", humanCard.id]]);
  assert.equal(game.activePlayerId, "demo-1");
  assert.strictEqual(playSelectedTrickCardOnce(game), game);

  for (const bot of game.players.slice(1)) {
    const expected = chooseBotTrickCard(bot.hand, game.currentTrick[0].card.suit);
    game = playNextDemoTrickCard(game);
    assert.equal(game.completedTricks.at(-1)?.cards.at(-1)?.card.id ?? game.currentTrick.at(-1)?.card.id, expected.id);
  }
  assert.equal(game.completedTricks.length, 1);
  assert.equal(game.waitingForNextTrick, true);
  assert.strictEqual(playNextDemoTrickCard(game), game);
  game = continueAfterTrickOnce(game);
  assert.equal(game.waitingForNextTrick, false);
  assert.equal(game.currentTrick.length, 0);
  assert.equal(new Set(allCardIds(game)).size, 52);
});

function withHands(game, hands, currentTrick = []) {
  const used = new Set([...hands.flat(), ...currentTrick.map((played) => played.card)].map((card) => card.id));
  return {
    ...game,
    players: game.players.map((player, index) => ({ ...player, hand: hands[index] })),
    deck: createDeck().filter((card) => !used.has(card.id)),
    discard: [],
    currentTrick,
    completedTricks: [],
    activePlayerId: "local",
    selectedCardIds: [],
    trickError: null,
  };
}

test("human selection reports an illegal off-suit card and cannot play it", () => {
  const local = hand(["2", H], ["K", S], ["3", C], ["4", D], ["5", H]);
  const bot = hand(["A", S], ["6", C], ["7", D], ["8", H]);
  let game = withHands(readyTricks(), [local, bot], [
    { playerId: "demo-1", card: card("9", H) },
  ]);
  assert.strictEqual(playTrickCardOnce(game, local[1].id), game);
  game = selectTrickCard(game, local[1].id);
  assert.deepEqual(game.selectedCardIds, [local[1].id]);
  assert.match(game.trickError, /måste följa/);
  const rejected = playSelectedTrickCard(game);
  assert.equal(rejected.players[0].hand.length, 5);
  assert.equal(rejected.currentTrick.length, 1);
  game = selectTrickCard(rejected, local[0].id);
  assert.equal(game.trickError, null);
  game = playSelectedTrickCard(game);
  assert.equal(game.completedTricks.length, 1);
  assert.equal(game.completedTricks[0].winnerId, "demo-1");
  assert.equal(new Set(allCardIds(game)).size, 52);
});

test("lead is unrestricted, bots follow suit, and the winner leads next", () => {
  const local = hand(["10", H], ["K", S], ["3", C], ["4", D], ["5", C]);
  const bot = hand(["A", H], ["6", C], ["7", D], ["8", S], ["9", C]);
  let game = withHands(readyTricks(), [local, bot]);
  game = selectTrickCard(game, local[0].id);
  assert.deepEqual(game.selectedCardIds, [local[0].id]);
  game = playSelectedTrickCard(game);
  assert.equal(game.completedTricks.length, 1);
  assert.equal(game.completedTricks[0].winnerId, "demo-1");
  assert.equal(game.completedTricks[0].cards[1].card.id, "hearts-A");
  assert.equal(game.waitingForNextTrick, true);
  assert.equal(game.currentTrick.length, 0);
  assert.strictEqual(playSelectedTrickCard(game), game);
  game = continueAfterTrick(game);
  assert.equal(game.currentTrick[0].playerId, "demo-1");
  assert.equal(game.activePlayerId, "local");
  assert.equal(game.waitingForNextTrick, false);
  assert.strictEqual(continueAfterTrick(game), game);
  assert.equal(new Set(allCardIds(game)).size, 52);
});

test("trick winner uses only the led suit; bot choice is legal and deterministic", () => {
  const cards = hand(["A", S], ["2", H], ["7", H], ["K", C], ["4", D]);
  assert.equal(chooseBotTrickCard(cards, H).id, "hearts-2");
  assert.equal(chooseBotTrickCard(cards, D).id, "diamonds-4");
  assert.equal(chooseBotTrickCard(cards, null).id, "hearts-2");
  assert.deepEqual(legalCards(cards, C).map((card) => card.id), ["clubs-K"]);
  assert.equal(trickWinner([
    { playerId: "one", card: card("10", H) },
    { playerId: "two", card: card("A", S) },
    { playerId: "three", card: card("Q", H) },
    { playerId: "four", card: card("K", C) },
  ]), "three");
});

for (const opponents of [1, 3]) {
  test(`${opponents + 1} players complete five tricks without card loss`, () => {
    let game = readyTricks(opponents);
    while (game.tableStage === "tricks") {
      assert.equal(game.activePlayerId, "local");
      const local = game.players.find((player) => player.id === game.ownerId);
      const card = legalCards(local.hand, game.currentTrick[0]?.card.suit ?? null)[0];
      const completedBefore = game.completedTricks.length;
      game = playSelectedTrickCard(selectTrickCard(game, card.id));
      assert.equal(game.completedTricks.length, completedBefore + 1);
      if (game.tableStage === "tricks") {
        assert.equal(game.waitingForNextTrick, true);
        const advanced = continueAfterTrick(game);
        assert.strictEqual(continueAfterTrick(advanced), advanced);
        game = advanced;
      }
      const ids = allCardIds(game);
      assert.equal(ids.length, 52);
      assert.equal(new Set(ids).size, 52);
    }
    assert.equal(game.tableStage, "result");
    assert.equal(game.completedTricks.length, 5);
    assert.ok(game.completedTricks.every((trick) => trick.cards.length === game.players.length));
    assert.ok(game.players.every((player) => player.hand.length === 0));
    assert.equal(game.currentTrick.length, 0);
    assert.equal(game.activePlayerId, null);
    assert.strictEqual(playSelectedTrickCard(game), game);
    const nextDeal = startRound(game);
    assert.equal(nextDeal.tableStage, "exchange");
    assert.equal(nextDeal.exchangeCount, 0);
    assert.equal(nextDeal.exchangeFeedback, null);
    assert.equal(nextDeal.waitingForNextTrick, false);
    assert.deepEqual(nextDeal.players.map((player) => player.score), game.players.map((player) => player.score));
  });
}

test("each player's played-card pile retains all five cards in play order", () => {
  let game = readyTricks(3);
  for (let turn = 1; turn <= 5; turn++) {
    const local = game.players.find((player) => player.id === game.ownerId);
    const legal = legalCards(local.hand, game.currentTrick[0]?.card.suit ?? null)[0];
    game = playSelectedTrickCard(selectTrickCard(game, legal.id));
    if (game.waitingForNextTrick) game = continueAfterTrick(game);
    for (const player of game.players) {
      const played = playedCardsForPlayer(game, player.id);
      const fromHistory = game.completedTricks.flatMap((trick) => trick.cards)
        .concat(game.currentTrick)
        .filter((entry) => entry.playerId === player.id)
        .map((entry) => entry.card.id);
      assert.deepEqual(played.map((card) => card.id), fromHistory);
      assert.ok(played.length >= turn && played.length <= Math.min(turn + 1, 5));
    }
  }
  assert.ok(game.players.every((player) => playedCardsForPlayer(game, player.id).length === 5));
});

test("bot discard choices follow the existing evaluator", () => {
  const expected = [3, 3, 1, 2, 0, 0, 0, 1, 0];
  examples.forEach(([category, cards], index) => {
    assert.equal(evaluateHand(cards).category, category);
    assert.equal(chooseBotDiscards(cards).length, expected[index]);
  });
  assert.deepEqual(
    chooseBotDiscards(examples[0][1]),
    examples[0][1].slice(2).map((card) => card.id),
  );
});

test("four players exchange directly and score only after exchanges 1 and 2", () => {
  let game = createRoom("Du", "ABCDE", "local");
  for (let i = 0; i < 3; i++) game = addDemoPlayer(game);
  game = startRound(game);
  assert.deepEqual(game.handAwards, []);
  assert.ok(game.players.every((player) => player.score === 0));
  assert.deepEqual(game.activity, []);
  assert.equal("handPresentation" in game, false);
  for (let round = 0; round < 3; round++) {
    const hand = game.players[0].hand;
    for (const selected of hand) game = toggleCard(game, selected.id);
    game = exchangeSelectedCards(game);
    assert.equal(game.exchangeCount, round + 1);
    assert.equal(game.players.length, 4);
    assert.ok(game.players.every((player) => player.hand.length === 5));
    const ids = allCardIds(game);
    assert.equal(ids.length, 52);
    assert.equal(new Set(ids).size, 52);
    assert.equal(game.handAwards.length, Math.min(round + 1, 2));
    assert.ok(game.activity.some((message) => message.startsWith("Alex ")));
  }
  assert.ok(game.finalHands);
  assert.equal(game.tableStage, "tricks");
});

test("shared discard pile can refill the deck without duplicating cards", () => {
  let game = startRound(addDemoPlayer(createRoom("Du", "ABCDE", "local")));
  game = { ...game, deck: game.deck.slice(0, 2), discard: game.deck.slice(2) };
  const initialIds = allCardIds(game);
  assert.equal(new Set(initialIds).size, 52);
  for (const selected of game.players[0].hand.slice(0, 5))
    game = toggleCard(game, selected.id);
  game = exchangeSelectedCards(game);
  assert.equal(game.exchangeCount, 1);
  assert.equal(allCardIds(game).length, 52);
  assert.equal(new Set(allCardIds(game)).size, 52);
});

test("exchange rejects impossible card zones and keep requires no selection", () => {
  const game = readyGame();
  const selected = toggleCard(game, game.players[0].hand[0].id);
  assert.strictEqual(keepHand(selected), selected);
  const duplicate = {
    ...selected,
    deck: [selected.players[0].hand[0], ...selected.deck.slice(1)],
  };
  assert.strictEqual(exchangeSelectedCards(duplicate), duplicate);
});

function exchangeFixture(localHand, botHand, deckFront = []) {
  let game = startRound(addDemoPlayer(createRoom("Du", "ABCDE", "local")));
  const held = new Set([...localHand, ...botHand].map((card) => card.id));
  const rest = createDeck().filter((card) => !held.has(card.id));
  const frontIds = new Set(deckFront.map((card) => card.id));
  game = {
    ...game,
    players: game.players.map((player) => ({
      ...player,
      hand: player.id === game.ownerId ? localHand : botHand,
    })),
    deck: [...deckFront, ...rest.filter((card) => !frontIds.has(card.id))],
  };
  assert.equal(new Set(allCardIds(game)).size, 52);
  return game;
}

test("only the best qualifying hand scores after exchanges 1 and 2; final hand waits", () => {
  const flush = hand(["A", H], ["J", H], ["9", H], ["6", H], ["3", H]);
  const straight = hand(["2", S], ["3", S], ["4", D], ["5", C], ["6", S]);
  let game = exchangeFixture(flush, straight);
  assert.deepEqual(game.players.map((player) => player.score), [0, 0]);
  for (const round of [1, 2, 3]) {
    game = keepHand(game);
    assert.equal(game.exchangeCount, round);
    assert.equal(game.handAwards.length, Math.min(round, 2));
    assert.deepEqual(game.players.map((player) => player.score), [Math.min(round, 2) * 5, 0]);
  }
  const snapshot = structuredClone(game.finalHands);
  assert.deepEqual(snapshot.local, flush);
  assert.deepEqual(snapshot["demo-1"], straight);
  assert.equal(game.tableStage, "tricks");
  assert.equal(game.finalTrickAward, null);
  assert.ok(!game.activity.some((event) => event.includes("efter byte 3")));

  while (game.tableStage === "tricks") {
    const local = game.players[0];
    const chosen = legalCards(local.hand, game.currentTrick[0]?.card.suit ?? null)[0];
    game = playSelectedTrickCard(selectTrickCard(game, chosen.id));
    if (game.waitingForNextTrick) game = continueAfterTrick(game);
    if (game.tableStage === "tricks") {
      assert.deepEqual(game.players.map((player) => player.score), [10, 0]);
      assert.equal(game.handAwards.length, 2);
    }
  }
  assert.deepEqual(game.finalHands, snapshot);
  assert.ok(game.players.every((player) => player.hand.length === 0));
  assert.equal(game.handAwards.length, 3);
  assert.equal(game.handAwards[2].winnerId, "local");
  assert.equal(game.handAwards[2].points, 5);
  assert.equal(game.handAwards[2].evaluations.local.category, "flush");
  assert.equal(game.finalTrickAward.winnerId, game.completedTricks[4].winnerId);
  assert.equal(game.finalTrickAward.points, 5);
  assert.equal(game.players.reduce((sum, player) => sum + player.score, 0), 20);
  assert.equal(game.players.find((player) => player.id === game.finalTrickAward.winnerId).score,
    (game.finalTrickAward.winnerId === "local" ? 15 : 0) + 5);
});

test("high-card hands award no poker points after the first exchange", () => {
  const local = hand(["A", S], ["K", H], ["9", D], ["6", C], ["3", S]);
  const bot = hand(["Q", S], ["J", H], ["8", D], ["5", C], ["2", S]);
  const replacements = hand(["4", D], ["7", C], ["10", H]);
  const game = keepHand(exchangeFixture(local, bot, replacements));
  assert.equal(game.handAwards[0].winnerId, null);
  assert.equal(game.handAwards[0].points, 0);
  assert.deepEqual(game.players.map((player) => player.score), [0, 0]);
});

test("final scoring uses the changed third-exchange hand, not an earlier hand", () => {
  const flush = hand(["A", H], ["J", H], ["9", H], ["6", H], ["3", H]);
  const straight = hand(["2", S], ["3", S], ["4", D], ["5", C], ["6", S]);
  let game = exchangeFixture(flush, straight, [card("Q", C)]);
  game = keepHand(game);
  game = keepHand(game);
  assert.deepEqual(game.players.map((player) => player.score), [10, 0]);
  game = toggleCard(game, card("3", H).id);
  game = exchangeSelectedCards(game);
  assert.equal(game.tableStage, "tricks");
  assert.equal(game.handAwards.length, 2);
  assert.equal(evaluateHand(game.finalHands.local).category, "high-card");
  assert.equal(evaluateHand(game.finalHands["demo-1"]).category, "straight");
  while (game.tableStage === "tricks") {
    const chosen = legalCards(game.players[0].hand, game.currentTrick[0]?.card.suit ?? null)[0];
    game = playSelectedTrickCard(selectTrickCard(game, chosen.id));
    if (game.waitingForNextTrick) game = continueAfterTrick(game);
  }
  assert.equal(game.handAwards[2].winnerId, "demo-1");
  assert.equal(game.handAwards[2].points, 4);
  assert.equal(game.handAwards[2].evaluations.local.category, "high-card");
  assert.equal(game.players.reduce((sum, player) => sum + player.score, 0), 19);
});

test("follow suit is mandatory for human and bot; off-suit aces cannot win", () => {
  const cards = hand(["A", S], ["2", H], ["7", H], ["K", C], ["4", D]);
  assert.deepEqual(legalCards(cards, H).map((card) => card.id), ["hearts-2", "hearts-7"]);
  assert.equal(chooseBotTrickCard(cards, H).id, "hearts-2");
  assert.deepEqual(legalCards(cards, null), cards);
  assert.deepEqual(legalCards(cards, C).map((card) => card.id), ["clubs-K"]);
  assert.equal(trickWinner([
    { playerId: "lead", card: card("3", H) },
    { playerId: "off-suit", card: card("A", S) },
    { playerId: "following", card: card("9", H) },
  ]), "following");
  assert.equal(finalTrickPoints(), 5);
});
