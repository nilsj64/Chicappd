import { createRoom, createDeck, applyCommand } from "../src/game.ts";

// A locked human with a flush and CPUs with two pairs: each CPU exchanges
// one kicker, and the offered low spades never change its discard strategy.
export function lockedHumanRoom(t, cpuCount = 1) {
  let game = createRoom("Ada", "TEST1", "ada");
  for (let i = 0; i < cpuCount; i++) game = applyCommand(game, { type: "add-bot", actorId: "ada" });
  game.players[0].score = 46;
  const ids = ["hearts-2", "hearts-4", "hearts-6", "hearts-8", "hearts-10",
    "spades-9", "hearts-9", "clubs-K", "diamonds-K", "clubs-4"];
  if (cpuCount === 2) ids.push("clubs-Q", "diamonds-Q", "clubs-J", "diamonds-J", "clubs-5");
  ids.push("spades-2", "spades-3", "spades-4", "spades-5", "spades-6", "spades-7");
  const deck = createDeck();
  const target = [...ids, ...deck.filter(c => !ids.includes(c.id)).map(c => c.id)];
  let i = deck.length - 1;
  t.mock.method(crypto, "getRandomValues", array => {
    const j = deck.findIndex(c => c.id === target[i]);
    [deck[i], deck[j]] = [deck[j], deck[i]];
    array[0] = j;
    i--;
    return array;
  });
  return game;
}
