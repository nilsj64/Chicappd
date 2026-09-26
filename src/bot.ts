import type { Card } from "./game.ts";
import { evaluateHand } from "./poker.ts";
import { cardValue, legalCards } from "./tricks.ts";
import type { Suit } from "./game.ts";

/** Card ids to discard. This decision has no deck or UI dependencies. */
export function chooseBotDiscards(hand: readonly Card[]): string[] {
  const category = evaluateHand(hand).category;
  if (["straight-flush", "full-house", "flush", "straight"].includes(category))
    return [];

  const counts = new Map<string, number>();
  for (const card of hand) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  if (category === "four-of-a-kind")
    return hand.filter((card) => counts.get(card.rank) !== 4).map((card) => card.id);
  if (category === "three-of-a-kind")
    return hand.filter((card) => counts.get(card.rank) !== 3).map((card) => card.id);
  if (category === "two-pair" || category === "one-pair")
    return hand.filter((card) => counts.get(card.rank) !== 2).map((card) => card.id);

  // Keep the two highest cards in an unmade hand, in original hand order.
  const values = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const kept = [...hand]
    .sort((a, b) => values.indexOf(b.rank) - values.indexOf(a.rank))
    .slice(0, 2);
  const keptIds = new Set(kept.map((card) => card.id));
  return hand.filter((card) => !keptIds.has(card.id)).map((card) => card.id);
}

/** Lowest legal card, with hand order breaking ties. */
export function chooseBotTrickCard(hand: readonly Card[], ledSuit: Suit | null): Card {
  const choices = legalCards(hand, ledSuit);
  if (!choices.length) throw new Error("A bot has no card to play.");
  return choices.reduce((lowest, card) =>
    cardValue(card) < cardValue(lowest) ? card : lowest,
  );
}
