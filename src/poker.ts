import type { Card, Rank } from "./game.ts";

export type HandCategory =
  | "high-card"
  | "one-pair"
  | "two-pair"
  | "three-of-a-kind"
  | "straight"
  | "flush"
  | "full-house"
  | "four-of-a-kind"
  | "straight-flush";

export const handCategories: readonly HandCategory[] = [
  "high-card", "one-pair", "two-pair", "three-of-a-kind", "straight",
  "flush", "full-house", "four-of-a-kind", "straight-flush",
];

export function handCategoryPoints(category: HandCategory): number {
  return handCategories.indexOf(category);
}

export type HandEvaluation = {
  category: HandCategory;
  /** Highest category wins; then compare these values from left to right. */
  strength: number;
  tiebreakers: number[];
  label: string;
};

const rankValue: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const rankPlural: Record<number, string> = {
  2: "tvåor",
  3: "treor",
  4: "fyror",
  5: "femmor",
  6: "sexor",
  7: "sjuor",
  8: "åttor",
  9: "nior",
  10: "tior",
  11: "knektar",
  12: "damer",
  13: "kungar",
  14: "ess",
};

function result(
  category: HandCategory,
  strength: number,
  tiebreakers: number[],
  label: string,
): HandEvaluation {
  return { category, strength, tiebreakers, label };
}

export function evaluateHand(cards: readonly Card[]): HandEvaluation {
  if (
    cards.length !== 5 ||
    new Set(cards.map((card) => `${card.suit}-${card.rank}`)).size !== 5
  ) {
    throw new Error("A poker hand must contain five different cards.");
  }

  const values = cards
    .map((card) => rankValue[card.rank])
    .sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0] - a[0],
  );
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const distinct = [...counts.keys()].sort((a, b) => b - a);
  const straightHigh =
    distinct.length === 5 &&
    (distinct[0] - distinct[4] === 4
      ? distinct[0]
      : distinct.join(",") === "14,5,4,3,2"
        ? 5
        : 0);

  if (straightHigh && flush)
    return result("straight-flush", handCategoryPoints("straight-flush"), [straightHigh], "Färgstege");
  if (groups[0][1] === 4)
    return result(
      "four-of-a-kind",
      handCategoryPoints("four-of-a-kind"),
      [groups[0][0], groups[1][0]],
      `Fyrtal – ${rankPlural[groups[0][0]]}`,
    );
  if (groups[0][1] === 3 && groups[1][1] === 2)
    return result(
      "full-house",
      handCategoryPoints("full-house"),
      [groups[0][0], groups[1][0]],
      `Kåk – ${rankPlural[groups[0][0]]} över ${rankPlural[groups[1][0]]}`,
    );
  if (flush) return result("flush", handCategoryPoints("flush"), values, "Färg");
  if (straightHigh) return result("straight", handCategoryPoints("straight"), [straightHigh], "Stege");
  if (groups[0][1] === 3)
    return result(
      "three-of-a-kind",
      handCategoryPoints("three-of-a-kind"),
      [
        groups[0][0],
        ...groups
          .slice(1)
          .map(([value]) => value)
          .sort((a, b) => b - a),
      ],
      `Triss – ${rankPlural[groups[0][0]]}`,
    );
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const highPair = Math.max(groups[0][0], groups[1][0]);
    const lowPair = Math.min(groups[0][0], groups[1][0]);
    return result(
      "two-pair",
      handCategoryPoints("two-pair"),
      [highPair, lowPair, groups[2][0]],
      `Två par – ${rankPlural[highPair]} och ${rankPlural[lowPair]}`,
    );
  }
  if (groups[0][1] === 2)
    return result(
      "one-pair",
      handCategoryPoints("one-pair"),
      [
        groups[0][0],
        ...groups
          .slice(1)
          .map(([value]) => value)
          .sort((a, b) => b - a),
      ],
      `Ett par – ${rankPlural[groups[0][0]]}`,
    );
  return result("high-card", handCategoryPoints("high-card"), values, `Högt kort – ${rankPlural[values[0]]}`);
}

/** Positive means first wins, negative means second wins, zero is a tie. */
export function compareHands(
  first: HandEvaluation,
  second: HandEvaluation,
): number {
  if (first.strength !== second.strength)
    return Math.sign(first.strength - second.strength);
  for (let i = 0; i < first.tiebreakers.length; i++) {
    if (first.tiebreakers[i] !== second.tiebreakers[i]) {
      return Math.sign(first.tiebreakers[i] - second.tiebreakers[i]);
    }
  }
  return 0;
}

const rankDisplay: Record<number, string> = {
  2: "två", 3: "tre", 4: "fyra", 5: "fem", 6: "sex", 7: "sju",
  8: "åtta", 9: "nio", 10: "tio", 11: "knekt", 12: "dam", 13: "kung", 14: "ess",
};

/** Reveal comparison ranks only at showdown when the category alone cannot decide. */
export function showdownHandLabel(evaluation: HandEvaluation, all: readonly HandEvaluation[]): string {
  return all.some((other) => other !== evaluation && other.category === evaluation.category)
    ? `${evaluation.label} (jämförelse: ${evaluation.tiebreakers.map((rank) => rankDisplay[rank]).join(", ")})`
    : evaluation.label;
}
