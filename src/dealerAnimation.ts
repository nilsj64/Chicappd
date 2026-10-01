// The supplied sheet has irregular spacing: use explicit crops, not a grid.
// Crops stay at native scale and are bottom-aligned inside a 160 × 158 viewport.
export const CHIBI_FRAMES = {
  neutral: [0, 0, 132, 158],
  idle: [132, 0, 140, 158],
  blink: [290, 0, 128, 158],
  ready: [0, 318, 148, 154],
  reach: [148, 318, 145, 154],
  release: [293, 318, 135, 154],
  point: [153, 944, 145, 156],
  offer: [0, 944, 153, 156],
} as const;
export type DealerAnimation = "idle" | "deal" | "offer";
export const DEALER_FRAME_MS = 80;
export const DEALER_RELEASE_MS = DEALER_FRAME_MS * 2;
export const DEALER_DEAL_MS = DEALER_FRAME_MS * 7;
export const EXCHANGE_STAGGER_MS = 65;
export const EXCHANGE_FLIGHT_MS = 520;
export const REPLACEMENT_FLIGHT_MS = 360;
export const REPLACEMENT_FLIP_MS = 180;
export const EXCHANGE_DEAL_PAUSE_MS = 80;
export const DEALER_ANIMATIONS = {
  idle: ["neutral", "idle", "neutral", "blink", "neutral"],
  deal: ["ready", "reach", "release", "release", "reach", "ready", "neutral"],
  offer: ["neutral", "point", "offer", "offer"],
} as const;

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
