import test from "node:test";
import assert from "node:assert/strict";
import { createRoom, createDeck, applyCommand, declareBotChicago, roomCapacity, viewForPlayer, CPU_REVEAL_MS, digitalMatchWinnerId } from "../src/game.ts";
import { shouldBotDeclareChicago } from "../src/bot.ts";
import { legalCards } from "../src/tricks.ts";
import { digitalResult, validDigitalHistory } from "../src/digitalHistory.ts";

const card = (suit, rank) => ({ id: `${suit}-${rank}`, suit, rank });
const strong = [card("spades", "A"), card("spades", "K"), card("spades", "Q"), card("hearts", "A"), card("hearts", "K")];
const risky = ["spades", "hearts", "diamonds", "clubs"].map(suit => card(suit, "A")).concat(card("hearts", "10"));
function cpuTricks(hand = strong, score = 38) {
  let game = applyCommand(createRoom("Ada", "ABCDE", "ada"), { type: "add-bot", actorId: "ada" });
  const human = hand === risky ? [card("hearts", "K"), card("hearts", "Q"), card("hearts", "J"), card("spades", "2"), card("diamonds", "2")]
    : [card("spades", "2"), card("spades", "3"), card("hearts", "2"), card("hearts", "3"), card("clubs", "2")];
  const used = new Set([...hand, ...human].map(c => c.id));
  return { ...game, phase: "table", dealNumber: 1, tableStage: "tricks", exchangeCount: 3, roundStarterId: "ada", activePlayerId: "ada",
    players: game.players.map(p => ({ ...p, hand: p.control === "bot" ? hand : human, score: p.control === "bot" ? score : 0 })),
    deck: createDeck().filter(c => !used.has(c.id)), finalHands: { ada: human, "demo-1": hand } };
}
function finish(game) {
  for (let steps = 0; steps < 100 && game.tableStage !== "result"; steps++) {
    if (game.waitingForNextTrick) game = applyCommand(game, { type: "continue-trick", actorId: game.ownerId });
    else {
      const active = game.players.find(p => p.id === game.activePlayerId);
      const completed = game.completedTricks.length;
      game = applyCommand(game, active.control === "bot" ? { type: "advance-bot", actorId: game.ownerId }
        : { type: "play-card", actorId: active.id, cardId: legalCards(active.hand, game.currentTrick[0]?.card.suit ?? null)[0].id });
      if (game.waitingForNextTrick) assert.equal(game.activePlayerId, game.completedTricks.at(-1).winnerId);
      else if (game.tableStage !== "result" && game.completedTricks.length === completed)
        assert.equal(game.activePlayerId, game.players[(game.players.findIndex(p => p.id === active.id) + 1) % game.players.length].id);
    }
  }
  assert.equal(game.tableStage, "result");
  return game;
}

test("CPU eligibility exactly follows score, phase, first-card window and declaration priority", () => {
  const base = cpuTricks();
  for (const game of [cpuTricks(strong, 14), { ...base, phase: "lobby" }, { ...base, tableStage: "exchange" },
    { ...base, currentTrick: [{ playerId: "ada", card: base.players[0].hand[0] }] },
    { ...base, completedTricks: [{ winnerId: "ada", cards: [] }] },
    { ...base, chicagoPlayerId: "ada" }]) assert.strictEqual(declareBotChicago(game), game);
  assert.equal(declareBotChicago(cpuTricks(strong, 15)).chicagoPlayerId, "demo-1");
  assert.equal(declareBotChicago({ ...base, roundStarterId: "demo-1", chicagoPlayerId: "ada" }).chicagoPlayerId, "demo-1");
});
test("CPU prefers five likely winners; only worthwhile match situations justify a high-card risk", () => {
  assert.equal(shouldBotDeclareChicago(strong, 15, false, []), true);
  assert.equal(shouldBotDeclareChicago(risky, 15, false, []), false);
  assert.equal(shouldBotDeclareChicago(risky, 38, true, []), true);
  assert.equal(shouldBotDeclareChicago(risky, 30, false, []), true);
  assert.equal(shouldBotDeclareChicago(risky, 30, true, []), false);
  assert.equal(shouldBotDeclareChicago(risky, 15, true, [{ score: 46, hasDeclaredChicago: true }]), true);
  assert.equal(shouldBotDeclareChicago(createDeck().slice(0, 5), 50, false, []), false);
  const game = cpuTricks();
  const concealed = { ...game, deck: [], finalHands: null, players: game.players.map(p => p.control === "human" ? { ...p, hand: [] } : p) };
  assert.equal(declareBotChicago(game).chicagoPlayerId, declareBotChicago(concealed).chicagoPlayerId);
});
for (const won of [true, false]) test(`CPU Chicago ${won ? "success" : "failure"} uses normal awards and persisted statistics`, () => {
  const base = cpuTricks(won ? strong : risky);
  const result = finish(declareBotChicago(base));
  assert.deepEqual(result.chicagoAward, { playerId: "demo-1", points: won ? 15 : -15 });
  assert.equal(result.players[1].hasDeclaredChicago, true);
  assert.equal(result.chicagoBreakerId, won ? null : "ada");
  const extra = (result.finalTrickAward.winnerId === "demo-1" ? result.finalTrickAward.points : 0) +
    result.handAwards.filter(a => a.winnerId === "demo-1").reduce((sum, a) => sum + a.points, 0);
  assert.equal(result.players[1].score, 38 + (won ? 15 : -15) + extra);
  if (won) assert.equal(digitalMatchWinnerId(result), "demo-1");
  const history = digitalResult(viewForPlayer(result, "ada"), "local", "ada");
  assert.equal(validDigitalHistory(history), true);
  assert.deepEqual(history.history[0].chicagoAward, result.chicagoAward);
});

test("CPU's public single-card offer lasts five seconds and accepts once without revealing its hand", t => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  let game = cpuTricks();
  const botHand = [card("spades", "9"), card("hearts", "9"), card("clubs", "K"), card("diamonds", "K"), card("clubs", "4")];
  const human = game.players[0].hand;
  const used = new Set([...human, ...botHand].map(c => c.id));
  game = { ...game, tableStage: "exchange", exchangeCount: 0, finalHands: null,
    players: game.players.map(p => p.control === "bot" ? { ...p, hand: botHand, score: 0 } : p),
    deck: createDeck().filter(c => !used.has(c.id)) };
  game = applyCommand(game, { type: "exchange", actorId: "ada", discardIds: [] });
  const offered = game.pendingExchange.card;
  assert.equal(game.pendingExchange.revealUntil, now + CPU_REVEAL_MS);
  const view = viewForPlayer(game, "ada");
  assert.deepEqual(view.players[1].hand, []);
  assert.deepEqual(view.pendingExchange, { playerId: "demo-1", card: offered });
  now += 4999;
  assert.strictEqual(applyCommand(game, { type: "advance-bot", actorId: "ada" }), game);
  now++;
  const accepted = applyCommand(game, { type: "advance-bot", actorId: "ada" });
  assert.equal(accepted.pendingExchange, null);
  assert.equal(accepted.exchangeCount, 1);
  assert.ok(accepted.players[1].hand.some(c => c.id === offered.id));
  assert.equal(accepted.exchangeEvents.filter(e => e.playerId === "demo-1").length, 1);
  assert.strictEqual(applyCommand(accepted, { type: "advance-bot", actorId: "ada" }), accepted);
});
test("CPU identities are stable, human names and old saved names are preserved", () => {
  let game = createRoom("Terra", "ABCDE", "ada");
  for (let i = 0; i < 3; i++) game = applyCommand(game, { type: "add-bot", actorId: "ada" });
  assert.deepEqual(game.players.map(p => p.name), ["Terra", "Terra", "Luna", "Astra"]);
  game = applyCommand(game, { type: "remove-player", actorId: "ada", playerId: "demo-2" });
  assert.equal(applyCommand(game, { type: "add-bot", actorId: "ada" }).players.at(-1).name, "Luna");
  const old = { ...game, players: game.players.map(p => p.id === "demo-1" ? { ...p, name: "Alex" } : p) };
  assert.equal(applyCommand(old, { type: "start-round", actorId: "ada" }).players[1].name, "Alex");
});
for (const count of [2, 3, 4, 5, 6]) test(`${count} human seats: capacity, recycling, turn order, scoring and history`, () => {
  let game = createRoom("Ada", "ABCDE", "ada");
  for (let index = 1; index < count; index++) game = applyCommand(game, { type: "add-human", actorId: "ada", playerId: `human-${index}`, name: `Human ${index}` });
  assert.equal(roomCapacity(game), 6);
  if (count === 6) assert.strictEqual(applyCommand(game, { type: "add-human", actorId: "ada", playerId: "seventh", name: "Extra" }), game);
  if (count >= 4) assert.strictEqual(applyCommand(game, { type: "add-bot", actorId: "ada" }), game);
  game = applyCommand(game, { type: "start-round", actorId: "ada" });
  assert.ok(game.players.every(p => p.hand.length === 5));
  // Fixed interleaved deal prevents accidental Royal Flushes during this deck stress test.
  const deck = createDeck();
  const hands = game.players.map((_, seat) => Array.from({ length: 5 }, (_, index) => deck[seat + index * count]));
  const used = new Set(hands.flat().map(c => c.id));
  game = { ...game, players: game.players.map((p, i) => ({ ...p, hand: hands[i] })), deck: deck.filter(c => !used.has(c.id)) };
  for (let exchange = 0; exchange < 3; exchange++) {
    for (let seat = 0; seat < count; seat++) {
      const active = game.players.find(p => p.id === game.activePlayerId);
      game = applyCommand(game, { type: "exchange", actorId: active.id, discardIds: active.hand.map(c => c.id) });
      const cards = [...game.deck, ...game.discard, ...game.players.flatMap(p => p.hand)];
      assert.equal(cards.length, 52);
      assert.equal(new Set(cards.map(c => c.id)).size, 52);
    }
    assert.equal(game.exchangeCount, exchange + 1);
  }
  game = finish(game);
  assert.equal(game.completedTricks.length, 5);
  assert.ok(game.completedTricks.every(trick => trick.cards.length === count && new Set(trick.cards.map(c => c.playerId)).size === count));
  assert.equal(game.players.reduce((sum, p) => sum + p.score, 0), game.handAwards.reduce((sum, a) => sum + a.points, 0) + game.finalTrickAward.points);
  assert.equal(validDigitalHistory(digitalResult(viewForPlayer(game, "ada"), "online", "ada")), true);
  assert.equal(applyCommand(game, { type: "start-round", actorId: "ada" }).roundStarterId, "human-1");
});

test("CPU Chicago remains a reward/risk decision when the victory prerequisite is OFF", () => {
  assert.equal(shouldBotDeclareChicago(strong, 15, false, [], false), true);
  assert.equal(shouldBotDeclareChicago(risky, 30, false, [], true), true);
  assert.equal(shouldBotDeclareChicago(risky, 30, false, [], false), false);
  assert.equal(shouldBotDeclareChicago(risky, 38, false, [], false), true);
  const game = cpuTricks(risky, 30);
  assert.equal(declareBotChicago({ ...game, settings: { ...game.settings, chicagoRequiredToWin: false } }).chicagoPlayerId, null);
  const strongGame = cpuTricks();
  assert.equal(declareBotChicago({ ...strongGame, settings: { ...strongGame.settings, chicagoRequiredToWin: false } }).chicagoPlayerId, "demo-1");
});

test("normal exchange completion declares eligible off-turn CPUs before any first card", () => {
  let game = cpuTricks(strong, 46);
  game = { ...game, tableStage: "exchange", exchangeCount: 0, finalHands: null };
  for (let exchange = 0; exchange < 3; exchange++) game = applyCommand(game, { type: "exchange", actorId: "ada", discardIds: [] });
  assert.equal(game.tableStage, "tricks");
  assert.equal(game.chicagoPlayerId, "demo-1");
  assert.equal(game.activePlayerId, "demo-1");
  assert.equal(game.currentTrick.length, 0);
  assert.equal(game.players[1].hasDeclaredChicago, false);
});
test("start validation rejects oversized human and CPU-inclusive saved rooms", () => {
  let game = createRoom("Ada", "ABCDE", "ada");
  game.players = Array.from({ length: 7 }, (_, i) => ({ ...game.players[0], id: i ? `h${i}` : "ada" }));
  assert.strictEqual(applyCommand(game, { type: "start-round", actorId: "ada" }), game);
  game = { ...game, players: game.players.slice(0, 5).map((p, i) => i === 4 ? { ...p, control: "bot" } : p) };
  assert.equal(roomCapacity(game), 4);
  assert.strictEqual(applyCommand(game, { type: "start-round", actorId: "ada" }), game);
});
