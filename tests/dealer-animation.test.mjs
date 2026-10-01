import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand, createRoom, addDemoPlayer } from "../src/game.ts";
import { exchangeNeedsDeal, exchangePlaybackMs, DEALER_RELEASE_MS, EXCHANGE_FLIGHT_MS,
  EXCHANGE_STAGGER_MS } from "../src/dealerAnimation.ts";

test("a public card is dealt once; declining it deals the hidden replacement", () => {
  const room = addDemoPlayer(createRoom("Ada", "CHIBI"));
  const game = applyCommand(room, { type: "start-round", actorId: room.ownerId });
  const offered = applyCommand(game, { type: "exchange", actorId: room.ownerId,
    discardIds: [game.players[0].hand[0].id] });
  assert.ok(offered.pendingExchange);
  const presentation = `${room.ownerId}:1`;
  for (const accept of [true, false]) {
    const answered = applyCommand(offered, { type: "exchange-choice", actorId: room.ownerId, accept });
    const event = answered.exchangeEvents.find(e => e.playerId === room.ownerId);
    assert.equal(exchangeNeedsDeal(event, presentation), !accept);
    // A client that didn't see the offer still animates the actual card delivery.
    assert.equal(exchangeNeedsDeal(event, undefined), true);
  }
});

test("keeping the hand has no deal; playback covers the last staggered card landing", () => {
  const room = addDemoPlayer(createRoom("Ada", "CHIBI"));
  const game = applyCommand(room, { type: "start-round", actorId: room.ownerId });
  const kept = applyCommand(game, { type: "exchange", actorId: room.ownerId, discardIds: [] });
  assert.equal(exchangeNeedsDeal(kept.exchangeEvents.find(e => e.playerId === room.ownerId)), false);
  const exchanged = applyCommand(game, { type: "exchange", actorId: room.ownerId,
    discardIds: game.players[0].hand.map(card => card.id) });
  const event = exchanged.exchangeEvents.find(e => e.playerId === room.ownerId);
  assert.equal(exchangeNeedsDeal(event), true);
  assert.ok(exchangePlaybackMs(event) >= DEALER_RELEASE_MS + EXCHANGE_FLIGHT_MS +
    EXCHANGE_STAGGER_MS * (event.changedCards - 1));
});
