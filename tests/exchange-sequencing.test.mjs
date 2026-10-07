import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createRoom, createDeck, viewForPlayer } from '../src/game.ts';
import { exchangeDisplayState } from '../src/exchangePresentation.ts';

export function mixedExchange() {
  let game = createRoom('Ada', 'ABCDE', 'human-a');
  for (const [playerId, name] of [['human-b', 'Bo'], ['human-c', 'Cy']])
    game = applyCommand(game, { type: 'add-human', actorId: 'human-a', playerId, name });
  game = applyCommand(game, { type: 'start-round', actorId: 'human-a' });
  const deck = createDeck();
  game = { ...game, players: game.players.map((player, i) => ({ ...player,
    hand: [deck[i], deck[i + 6], deck[i + 12], deck[i + 18], deck[i + 24]] })),
    deck: deck.filter(card => ![0, 1, 2, 6, 7, 8, 12, 13, 14, 18, 19, 20, 24, 25, 26].includes(deck.indexOf(card))) };
  for (let pass = 0; pass < 2; pass++) for (const player of game.players)
    game = applyCommand(game, { type: 'exchange', actorId: player.id, discardIds: [] });
  const before = viewForPlayer(game, 'human-a');
  game = applyCommand(game, { type: 'exchange', actorId: 'human-a', discardIds: game.players[0].hand.slice(0, 3).map(card => card.id) });
  game = applyCommand(game, { type: 'exchange', actorId: 'human-b', discardIds: [game.players[1].hand[0].id] });
  const offered = viewForPlayer(game, 'human-a');
  game = applyCommand(game, { type: 'exchange-choice', actorId: 'human-b', accept: true });
  game = applyCommand(game, { type: 'exchange', actorId: 'human-c', discardIds: game.players[2].hand.slice(0, 2).map(card => card.id) });
  return { before, offered, final: viewForPlayer(game, 'human-a') };
}

test('mixed 3/1/2 exchanges hold the next offer and trick stage behind the oldest unfinished player', () => {
  const { before, offered, final } = mixedExchange();
  const seen = before.exchangeEvents.at(-1).id;
  const events = final.exchangeEvents.filter(event => event.id > seen);
  assert.deepEqual(events.map(event => [event.playerId, event.changedCards]), [['human-a', 3], ['human-b', 1], ['human-c', 2]]);
  assert.equal(final.tableStage, 'tricks');
  const backup = JSON.stringify(final);
  const unseen = exchangeDisplayState(offered, [], seen);
  assert.equal(unseen.busy, true);
  assert.equal(unseen.pendingExchange, null);
  assert.equal(unseen.activePlayerId, 'human-a');
  const completedA = exchangeDisplayState(offered, [], events[0].id);
  assert.equal(completedA.pendingExchange.playerId, 'human-b');
  for (let i = 0; i < events.length; i++) {
    const display = exchangeDisplayState(final, events.slice(i).map(event => ({ event })), events.at(-1).id);
    assert.equal(display.exchanging, true);
    assert.equal(display.pendingExchange, null);
    assert.equal(display.activePlayerId, events[i].playerId);
    assert.equal(display.exchangeCount, 2);
  }
  const drained = exchangeDisplayState(final, [], events.at(-1).id);
  assert.equal(drained.busy, false);
  assert.equal(drained.exchanging, false);
  assert.equal(JSON.stringify(final), backup);
});
