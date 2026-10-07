import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand, createRoom, addDemoPlayer } from "../src/game.ts";
import { exchangeTimeline, DEALER_RELEASE_MS, REPLACEMENT_FLIGHT_MS,
  REPLACEMENT_FLIP_MS } from "../src/dealerAnimation.ts";
import { exchangeHandSlots } from "../src/exchangePresentation.ts";

function round() {
  const room = addDemoPlayer(createRoom("Ada", "CHIBI"));
  return applyCommand(room, { type: "start-round", actorId: room.ownerId });
}
const ids = hand => hand.map(card => card.id).sort();

for (const accept of [true, false]) test(`single-card ${accept ? "acceptance" : "rejection"} delivers the actual replacement into the vacated slot`, () => {
  const game = round();
  const before = game.players[0].hand;
  const offered = applyCommand(game, { type: "exchange", actorId: game.ownerId, discardIds: [before[1].id] });
  assert.ok(offered.pendingExchange);
  const answered = applyCommand(offered, { type: "exchange-choice", actorId: game.ownerId, accept });
  const after = answered.players[0].hand;
  const backup = JSON.stringify(answered);
  const presentation = exchangeHandSlots(before, after);
  assert.equal(presentation.replacements.length, 1);
  assert.equal(presentation.replacements[0].slot, 1);
  const delivered = presentation.replacements[0].card;
  assert.ok(after.includes(delivered));
  assert.equal(delivered.id === offered.pendingExchange.card.id, accept);
  assert.deepEqual(ids(presentation.hand), ids(after));
  for (const slot of [0, 2, 3, 4]) assert.equal(presentation.hand[slot].id, before[slot].id);
  assert.equal(JSON.stringify(answered), backup);
});

for (const count of [2, 3, 5]) test(`${count} replacements preserve retained positions and authoritative card identity`, () => {
  const game = round();
  const before = game.players[0].hand;
  const selected = count === 2 ? [before[1], before[3]] : before.slice(0, count);
  const exchanged = applyCommand(game, { type: "exchange", actorId: game.ownerId, discardIds: selected.map(c => c.id) });
  const after = exchanged.players[0].hand;
  const backup = JSON.stringify(exchanged);
  const presentation = exchangeHandSlots(before, after);
  assert.equal(presentation.replacements.length, count);
  assert.deepEqual(presentation.discarded, selected);
  assert.deepEqual(ids(presentation.hand), ids(after));
  for (const replacement of presentation.replacements) {
    assert.ok(selected.some(card => before[replacement.slot] === card));
    assert.ok(after.includes(replacement.card));
  }
  before.forEach((card, slot) => {
    if (!selected.includes(card)) assert.equal(presentation.hand[slot].id, card.id);
  });
  assert.equal(JSON.stringify(exchanged), backup);
});

test("replacement timing waits for discards, releases with the dealer, and finishes before the next deal", () => {
  for (const count of [1, 3, 5]) {
    const timeline = exchangeTimeline(count);
    assert.equal(timeline.replacements.length, count);
    timeline.replacements.forEach((timing, index) => {
      assert.ok(timing.deal > timeline.discardEnd);
      assert.equal(timing.depart - timing.deal, DEALER_RELEASE_MS);
      assert.equal(timing.arrive - timing.depart, REPLACEMENT_FLIGHT_MS);
      assert.equal(timing.reveal - timing.arrive, REPLACEMENT_FLIP_MS);
      if (index) assert.ok(timing.deal > timeline.replacements[index - 1].reveal);
    });
    assert.equal(timeline.duration, timeline.replacements.at(-1).reveal);
  }
});

test("keeping cards creates no replacement playback", () => {
  const game = round();
  const kept = applyCommand(game, { type: "exchange", actorId: game.ownerId, discardIds: [] });
  assert.deepEqual(exchangeHandSlots(game.players[0].hand, kept.players[0].hand).replacements, []);
  assert.deepEqual(exchangeTimeline(0).replacements, []);
});

test('the selected poses all belong to gameplay actions and release timing matches the deal sequence', async () => {
  const { CHIBI_FRAMES, CHIBI_BODY_X, DEALER_ANIMATIONS, DEALER_FRAME_MS,
    DEALER_RELEASE_FRAME, DEALER_DEAL_MS } = await import('../src/dealerAnimation.ts');
  const used = new Set(Object.values(DEALER_ANIMATIONS).flat());
  assert.deepEqual([...used].sort(), Object.keys(CHIBI_FRAMES).sort());
  for (const frame of used) assert.ok(Number.isFinite(CHIBI_BODY_X[frame]));
  assert.equal(DEALER_ANIMATIONS.deal[DEALER_RELEASE_FRAME], 'release');
  assert.equal(DEALER_RELEASE_MS, DEALER_RELEASE_FRAME * DEALER_FRAME_MS);
  assert.equal(DEALER_DEAL_MS, DEALER_ANIMATIONS.deal.length * DEALER_FRAME_MS);
});
