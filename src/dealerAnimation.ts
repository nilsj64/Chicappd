import type { ExchangeEvent } from "./game";

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
export const DEALER_ANIMATIONS = {
  idle: ["neutral", "idle", "neutral", "blink", "neutral"],
  deal: ["ready", "reach", "release", "release", "reach", "ready", "neutral"],
  offer: ["neutral", "point", "offer", "offer"],
} as const;

export function exchangeNeedsDeal(event: ExchangeEvent | undefined, presented: string | undefined) {
  return !!event?.changedCards && !(event.singleCardChoice === "accepted" &&
    presented === `${event.playerId}:${event.exchangeCount}`);
}

export function exchangePlaybackMs(event: ExchangeEvent) {
  return event.changedCards
    ? Math.max(DEALER_DEAL_MS, DEALER_RELEASE_MS + EXCHANGE_FLIGHT_MS +
      EXCHANGE_STAGGER_MS * (event.changedCards - 1))
    : 450;
}
