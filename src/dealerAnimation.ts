// The supplied sheet has irregular spacing: use explicit crops, not a grid.
// Only gameplay poses are referenced. Keep the body planted despite different
// arm/tail extents; the atlas is source art, not a grid or a random pose pool.
export const CHIBI_FRAMES = {
  neutral: [0, 0, 132, 158],
  idle: [132, 0, 140, 158],
  blink: [290, 0, 128, 158],
  ready: [0, 318, 148, 154],
  reach: [148, 318, 145, 154],
  release: [428, 318, 148, 154],
  extend: [293, 318, 135, 154],
  follow: [576, 318, 145, 154],
  recover: [721, 318, 139, 154],
  point: [153, 944, 145, 156],
  offer: [0, 944, 153, 156],
} as const;
export type DealerAnimation = "idle" | "deal" | "offer";
export const DEALER_FRAME_MS = 70;
export const DEALER_RELEASE_FRAME = 3;
export const DEALER_RELEASE_MS = DEALER_FRAME_MS * DEALER_RELEASE_FRAME;
export const DEALER_DEAL_MS = DEALER_FRAME_MS * 8;
export const EXCHANGE_STAGGER_MS = 65;
export const EXCHANGE_FLIGHT_MS = 520;
export const REPLACEMENT_FLIGHT_MS = 360;
export const REPLACEMENT_FLIP_MS = 180;
export const EXCHANGE_DEAL_PAUSE_MS = 80;
export const DEALER_ANIMATIONS = {
  idle: ["neutral", "idle", "neutral", "blink", "neutral"],
  deal: ["ready", "reach", "extend", "release", "follow", "recover", "ready", "neutral"],
  offer: ["neutral", "point", "offer", "offer"],
} as const;

// Grounded torso anchors, rather than the centre of each changing crop.
export const CHIBI_BODY_X = {
  neutral: 74, idle: 73, blink: 61, ready: 85, reach: 82,
  extend: 75, release: 82, follow: 79, recover: 76, point: 73, offer: 78,
} as const;
export type DealerDirection = "left" | "right";
export function dealerMirrored(animation: DealerAnimation, direction: DealerDirection) {
  // The deal artwork faces left, whereas the offer artwork faces right.
  return animation === "deal" ? direction === "right" : animation === "offer" && direction === "left";
}
export const DEALER_HAND = { x: 26, y: 112 } as const;

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
