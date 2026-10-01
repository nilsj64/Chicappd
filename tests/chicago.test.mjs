import test from "node:test";
import assert from "node:assert/strict";
import { defaultSettings } from "../src/scoring.ts";
import { applyCommand, createDeck, createRoom, startRound, viewForPlayer, canPlayerDeclareChicago } from "../src/game.ts";

function setup(winningChicago = false) {
  let game = createRoom("Ada", "ABCDE", "ada");
  game = applyCommand(game, { type: "add-human", actorId: "ada", playerId: "bea", name: "Bea" });
  game = startRound(game);
  const ranks = ["10", "J", "Q", "K", "A"];
  const ada = ranks.map((rank) => ({ id: `spades-${rank}`, suit: "spades", rank }));
  if (!winningChicago) ada[4] = { id: "diamonds-2", suit: "diamonds", rank: "2" };
  const bea = winningChicago
    ? ["2", "3", "4", "5", "6"].map((rank) => ({ id: `hearts-${rank}`, suit: "hearts", rank }))
    : [{ id: "spades-A", suit: "spades", rank: "A" }, ...["2", "3", "4", "5"].map((rank) => ({ id: `hearts-${rank}`, suit: "hearts", rank }))];
  const used = new Set([...ada, ...bea].map((card) => card.id));
  return { ...game, tableStage: "tricks", exchangeCount: 3, deck: createDeck().filter((card) => !used.has(card.id)),
    players: game.players.map((player) => ({ ...player, score: player.id === "ada" ? 15 : 0,
      hand: player.id === "ada" ? ada : bea })) };
}

function playAll(game) {
  while (game.tableStage === "tricks") {
    if (game.waitingForNextTrick) {
      game = applyCommand(game, { type: "continue-trick", actorId: "ada" });
      continue;
    }
    const active = game.players.find((player) => player.id === game.activePlayerId);
    const suit = game.currentTrick[0]?.card.suit;
    const card = active.hand.find((card) => card.suit === suit) ?? active.hand[0];
    game = applyCommand(game, { type: "play-card", actorId: active.id, cardId: card.id });
  }
  return game;
}

test("Chicago requires 15 current points, including exactly 15", () => {
  let game = setup(true);
  const low = { ...game, players: game.players.map((p) => p.id === "ada" ? { ...p, score: 14 } : p) };
  assert.strictEqual(applyCommand(low, { type: "declare-chicago", actorId: "ada" }), low);
  game = applyCommand(game, { type: "declare-chicago", actorId: "ada" });
  assert.equal(game.chicagoPlayerId, "ada");
  assert.equal(game.players[0].hasDeclaredChicago, false);
  assert.equal(viewForPlayer(game, "bea").players[0].hasDeclaredChicago, false);
  assert.equal(viewForPlayer(game, "bea").chicagoPlayerId, "ada");
  assert.strictEqual(applyCommand(game, { type: "declare-chicago", actorId: "bea" }), game);
  const started = applyCommand(game, { type: "play-card", actorId: "ada", cardId: game.players[0].hand[0].id });
  assert.equal(started.players[0].hasDeclaredChicago, true);
  assert.strictEqual(applyCommand(started, { type: "declare-chicago", actorId: "bea" }), started);
});

test("only the room owner can set scoring rules and disabling negatives clamps existing scores", () => {
  let game = setup(false);
  game = { ...game, phase: "lobby", players: game.players.map((p) => p.id === "bea" ? { ...p, score: -7 } : p) };
  const settings = { finalTrickPoints: 2, allowNegativeScores: false };
  assert.strictEqual(applyCommand(game, { type: "set-settings", actorId: "bea", settings }), game);
  game = applyCommand(game, { type: "set-settings", actorId: "ada", settings });
  assert.deepEqual(game.settings, { ...defaultSettings, ...settings });
  assert.equal(game.players[1].score, 0);
});

test("winning Chicago awards 15 once and keeps normal final-trick points", () => {
  let game = applyCommand(setup(true), { type: "declare-chicago", actorId: "ada" });
  game = playAll(game);
  assert.deepEqual(game.chicagoAward, { playerId: "ada", points: 15 });
  assert.equal(game.chicagoBreakerId, null);
  assert.equal(game.players[0].score, 35);
  assert.ok(game.activity.some((event) => /sista sticket \(\+5 p enligt regeln för sista sticket\)/.test(event)));
  assert.ok(game.activity.some((event) => /vann Chicago \(\+15 p\)/.test(event)));
  assert.strictEqual(applyCommand(game, { type: "continue-trick", actorId: "ada" }), game);
});

test("first breaker alone gets 10 and losing Chicago costs 15", () => {
  let game = applyCommand(setup(false), { type: "declare-chicago", actorId: "ada" });
  game = playAll(game);
  assert.deepEqual(game.chicagoAward, { playerId: "ada", points: -15 });
  assert.equal(game.chicagoBreakerId, "bea");
  assert.equal(game.players[0].score, 0);
  assert.equal(game.players[0].hasDeclaredChicago, true);
  assert.equal(game.players[1].score, 15); // +10 break and +5 final trick
  assert.equal(game.activity.filter((event) => event.includes("bröt Chicago")).length, 1);
  const nextRound = applyCommand(game, { type: "start-round", actorId: "ada" });
  assert.equal(nextRound.players[0].hasDeclaredChicago, true);
});

test("negative-score setting applies to Chicago and 2/5 remains final-trick scoring", () => {
  for (const allowNegativeScores of [false, true]) {
    let game = setup(false);
    game = { ...game, settings: { finalTrickPoints: 2, allowNegativeScores } };
    game = applyCommand(game, { type: "declare-chicago", actorId: "ada" });
    game = { ...game, players: game.players.map((p) => p.id === "ada" ? { ...p, score: 8 } : p) };
    game = playAll(game);
    assert.equal(game.players[0].score, allowNegativeScores ? -7 : 0);
    assert.equal(game.players[1].score, 12);
    assert.equal(game.finalTrickAward.points, 2);
  }
  const normal = playAll({ ...setup(false), settings: { finalTrickPoints: 2, allowNegativeScores: false } });
  assert.equal(normal.chicagoAward, null);
  assert.equal(normal.chicagoBreakerId, null);
  assert.equal(normal.players[1].score, 2);
});


test("Chicago is available off-turn and priority follows the rotated starter, independent of arrival order", () => {
  let room = createRoom("Ada", "ABCDE", "ada");
  for (const id of ["bea", "cid", "dan"]) room = applyCommand(room, { type: "add-human", actorId: "ada", playerId: id, name: id });
  const base = { ...startRound(room), tableStage: "tricks", exchangeCount: 3, roundStarterId: "cid", activePlayerId: "cid" };
  base.players = base.players.map((player) => ({ ...player, score: 15 }));
  for (const order of [["ada", "dan", "bea", "cid"], ["cid", "bea", "dan", "ada"], ["bea", "ada", "cid", "dan"]]) {
    let game = base;
    assert.equal(canPlayerDeclareChicago(viewForPlayer(game, "ada"), "ada"), true);
    for (const id of order) game = applyCommand(game, { type: "declare-chicago", actorId: id });
    assert.equal(game.chicagoPlayerId, "cid");
    assert.equal(game.activePlayerId, "cid");
    game = applyCommand(game, { type: "play-card", actorId: "cid", cardId: game.players[2].hand[0].id });
    assert.deepEqual(game.players.filter((player) => player.hasDeclaredChicago).map((player) => player.id), ["cid"]);
    assert.equal(canPlayerDeclareChicago(game, "ada"), false);
    assert.strictEqual(applyCommand(game, { type: "declare-chicago", actorId: "ada" }), game);
  }
  // Without a claim from the starter, the next seat wins, including wraparound.
  for (const order of [["bea", "ada", "dan"], ["dan", "ada", "bea"]]) {
    let game = base;
    for (const id of order) game = applyCommand(game, { type: "declare-chicago", actorId: id });
    assert.equal(game.chicagoPlayerId, "dan");
    assert.equal(game.activePlayerId, "dan");
    assert.equal(game.roundStarterId, "cid");
  }
  const historic = { ...base, players: base.players.map((p) => p.id === "ada" ? { ...p, hasDeclaredChicago: true } : p) };
  let game = applyCommand(historic, { type: "declare-chicago", actorId: "ada" });
  game = applyCommand(game, { type: "declare-chicago", actorId: "cid" });
  game = applyCommand(game, { type: "play-card", actorId: "cid", cardId: game.players[2].hand[0].id });
  assert.equal(game.players[0].hasDeclaredChicago, true);
});


test("the Chicago claimant leads, turn order wraps once and only the trick winner leads next", () => {
  let room = createRoom("Ada", "ABCDE", "ada");
  for (const id of ["bea", "cid", "dan"]) room = applyCommand(room, { type: "add-human", actorId: "ada", playerId: id, name: id });
  let game = { ...startRound(room), tableStage: "tricks", exchangeCount: 3,
    roundStarterId: "cid", activePlayerId: "cid", selectedCardIds: ["stale-selection"] };
  game.players = game.players.map(p => ({ ...p, score: 15 }));
  const original = game;
  game = applyCommand(game, { type: "declare-chicago", actorId: "dan" });
  assert.equal(game.activePlayerId, "dan");
  assert.equal(game.roundStarterId, "cid");
  assert.deepEqual(game.selectedCardIds, []);
  assert.strictEqual(applyCommand(game, { type: "play-card", actorId: "cid", cardId: game.players[2].hand[0].id }), game);
  for (const id of ["dan", "ada", "bea", "cid"]) {
    assert.equal(game.activePlayerId, id);
    const player = game.players.find(p => p.id === id);
    const suit = game.currentTrick[0]?.card.suit;
    const card = player.hand.find(c => c.suit === suit) ?? player.hand[0];
    game = applyCommand(game, { type: "play-card", actorId: id, cardId: card.id });
  }
  assert.equal(game.completedTricks.length, 1);
  assert.deepEqual(game.completedTricks[0].cards.map(p => p.playerId), ["dan", "ada", "bea", "cid"]);
  assert.ok(game.players.every(p => p.hand.length === 4));
  assert.deepEqual(game.players.filter(p => p.hasDeclaredChicago).map(p => p.id), ["dan"]);
  assert.equal(game.activePlayerId, game.completedTricks[0].winnerId);
  game = applyCommand(game, { type: "continue-trick", actorId: "ada" });
  assert.equal(game.activePlayerId, game.completedTricks[0].winnerId);
  assert.equal(game.waitingForNextTrick, false);
  // A higher-priority claimant takes both Chicago and the lead before the first card.
  let takeover = applyCommand(original, { type: "declare-chicago", actorId: "dan" });
  takeover = applyCommand(takeover, { type: "declare-chicago", actorId: "cid" });
  assert.equal(takeover.chicagoPlayerId, "cid");
  assert.equal(takeover.activePlayerId, "cid");
  assert.equal(takeover.roundStarterId, "cid");
});
