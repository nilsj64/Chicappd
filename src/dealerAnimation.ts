// Optimized 8 × 4 sheet. Trim the thin cell separators, retaining a common
// cell viewport so the feet and scale do not jump between actions.
export const CHIBI_SHEET = { width: 1774, height: 887, columns: 8, rows: 4 } as const;
function cell(row: number, column: number): readonly [number, number, number, number] {
  const x = Math.round(column * CHIBI_SHEET.width / CHIBI_SHEET.columns);
  const y = Math.round(row * CHIBI_SHEET.height / CHIBI_SHEET.rows);
  return [x + 4, y + 4,
    Math.round((column + 1) * CHIBI_SHEET.width / CHIBI_SHEET.columns) - x - 8,
    Math.round((row + 1) * CHIBI_SHEET.height / CHIBI_SHEET.rows) - y - 8];
}
export const CHIBI_FRAMES = {
  idle0: cell(0, 0), idle1: cell(0, 1), idle2: cell(0, 2), idle3: cell(0, 3),
  idle4: cell(0, 4), idle5: cell(0, 5), idle6: cell(0, 6), idle7: cell(0, 7),
  deal0: cell(1, 0), deal1: cell(1, 1), deal2: cell(1, 2), deal3: cell(1, 3),
  deal4: cell(1, 4), deal5: cell(1, 5), deal6: cell(1, 6), deal7: cell(1, 7),
  deal8: cell(2, 0), deal9: cell(2, 1), deal10: cell(2, 2),
  offer0: cell(3, 0), offer1: cell(3, 1), offer2: cell(3, 2), offer3: cell(3, 3),
  offer4: cell(3, 4), offer5: cell(3, 5), offer6: cell(3, 6), offer7: cell(3, 7),
} as const;
export type DealerAnimation = "idle" | "deal" | "offer";
export const DEALER_ANIMATIONS = {
  idle: ["idle0", "idle1", "idle2", "idle3", "idle4", "idle5", "idle6", "idle7"],
  // Row 3, column 4 is transparent in the supplied file. Hold the preceding
  // neutral pose for the twelfth step rather than rendering a blank character.
  deal: ["deal0", "deal1", "deal2", "deal3", "deal4", "deal5", "deal6", "deal7", "deal8", "deal9", "deal10", "deal10"],
  offer: ["offer0", "offer1", "offer2", "offer3", "offer4", "offer5", "offer6", "offer7"],
} as const;
export const DEALER_IDLE_FRAME_MS = [1800, 100, 100, 100, 80, 80, 100, 100] as const;
export const DEALER_FRAME_MS = 50;
// Row 2, column 7: the card first separates from the outstretched left hand.
export const DEALER_RELEASE_FRAME = 6;
export const DEALER_RELEASE_MS = DEALER_FRAME_MS * DEALER_RELEASE_FRAME;
export const DEALER_DEAL_MS = DEALER_FRAME_MS * DEALER_ANIMATIONS.deal.length;
// Hand position in the fixed 160 × 158 dealer viewport, before any UI scaling.
export const DEALER_HAND = { x: 34, y: 97 } as const;
export const EXCHANGE_STAGGER_MS = 65;
export const EXCHANGE_FLIGHT_MS = 520;
export const REPLACEMENT_FLIGHT_MS = 360;
export const REPLACEMENT_FLIP_MS = 180;
export const EXCHANGE_DEAL_PAUSE_MS = 80;

/** Every replacement starts only after all discards land; one delivery at a time. */
export function exchangeTimeline(outgoingCount: number, replacementCount = outgoingCount) {
  const discardEnd = outgoingCount
    ? DEALER_RELEASE_MS + EXCHANGE_FLIGHT_MS + EXCHANGE_STAGGER_MS * (outgoingCount - 1) : 0;
  const cadence = DEALER_RELEASE_MS + REPLACEMENT_FLIGHT_MS + REPLACEMENT_FLIP_MS + EXCHANGE_STAGGER_MS;
  const replacements = Array.from({ length: replacementCount }, (_, index) => {
    const deal = discardEnd + EXCHANGE_DEAL_PAUSE_MS + index * cadence;
    const depart = deal + DEALER_RELEASE_MS;
    const arrive = depart + REPLACEMENT_FLIGHT_MS;
    return { deal, depart, arrive, reveal: arrive + REPLACEMENT_FLIP_MS };
  });
  return { discardEnd, replacements, duration: replacements.at(-1)?.reveal ?? (discardEnd || 450) };
}
