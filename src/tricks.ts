import type { Card, Rank, Suit } from "./game.ts";

export type PlayedCard = { playerId: string; card: Card };

const rankValue: Record<Rank, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13, A: 14,
};

export function cardValue(card: Card): number {
  return rankValue[card.rank];
}

export function legalCards(hand: readonly Card[], ledSuit: Suit | null): Card[] {
  if (!ledSuit) return [...hand];
  const following = hand.filter((card) => card.suit === ledSuit);
  return following.length ? following : [...hand];
}

export function trickWinner(cards: readonly PlayedCard[]): string {
  if (!cards.length) throw new Error("A trick needs at least one card.");
  const ledSuit = cards[0].card.suit;
  return cards.reduce((winner, played) =>
    played.card.suit === ledSuit && cardValue(played.card) > cardValue(winner.card)
      ? played
      : winner,
  ).playerId;
}
