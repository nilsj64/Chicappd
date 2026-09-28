import type { GameSettings } from "./game.ts";

export const defaultSettings: GameSettings = { finalTrickPoints: 5, allowNegativeScores: false };
export const chicagoThreshold = 15;
export const chicagoPoints = 15;
export const chicagoBreakPoints = 10;

export function finalTrickPoints(settings?: GameSettings): 2 | 5 {
  return settings?.finalTrickPoints ?? defaultSettings.finalTrickPoints;
}

export function scoreAfter(current: number, change: number, settings: GameSettings): number {
  const total = current + change;
  return settings.allowNegativeScores ? total : Math.max(0, total);
}

export function canDeclareChicago(score: number): boolean {
  return score >= chicagoThreshold;
}

export function chicagoResult(wonAllTricks: boolean): 15 | -15 {
  return wonAllTricks ? chicagoPoints : -15;
}
