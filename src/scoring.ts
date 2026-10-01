import type { GameSettings } from "./game.ts";

export const defaultSettings: GameSettings = {
  finalTrickPoints: 5, allowNegativeScores: false,
  requireOver52ToWin: false, resetOver52WithoutChicago: false,
};

/** Older saved rooms omit the optional rules; they use the default off state. */
export function normalizeSettings(settings?: Partial<GameSettings>): GameSettings {
  return {
    finalTrickPoints: settings?.finalTrickPoints ?? defaultSettings.finalTrickPoints,
    allowNegativeScores: settings?.allowNegativeScores ?? false,
    requireOver52ToWin: settings?.requireOver52ToWin ?? false,
    resetOver52WithoutChicago: settings?.resetOver52WithoutChicago ?? false,
  };
}

export function validSettings(settings: GameSettings): boolean {
  return !!settings && [2, 5].includes(settings.finalTrickPoints) &&
    typeof settings.allowNegativeScores === "boolean" &&
    [settings.requireOver52ToWin, settings.resetOver52WithoutChicago].every(value =>
      value === undefined || typeof value === "boolean");
}
export const chicagoThreshold = 15;
export const chicagoPoints = 15;
export const chicagoBreakPoints = 10;
export const exchangeLockScore = 46;
export const winningScore = 52;

export function canExchangeCards(score: number): boolean {
  return score < exchangeLockScore;
}

export function matchWinnerId(players: readonly { id: string; score: number; hasDeclaredChicago?: boolean }[], settings?: GameSettings): string | null {
  const eligible = players.filter((player) => (settings?.requireOver52ToWin ? player.score > winningScore : player.score >= winningScore) && player.hasDeclaredChicago);
  if (!eligible.length) return null;
  const highest = Math.max(...eligible.map((player) => player.score));
  const leaders = eligible.filter((player) => player.score === highest);
  return leaders.length === 1 ? leaders[0].id : null;
}

/** Equal scores retain seat order; never mutate the playing order. */
export function scoreStandings<T extends { score: number }>(players: readonly T[]): T[] {
  return [...players].sort((left, right) => right.score - left.score || players.indexOf(left) - players.indexOf(right));
}

export function matchStandings<T extends { id: string; score: number }>(players: readonly T[], winnerId: string): T[] {
  return [...players].sort((left, right) =>
    (left.id === winnerId ? -1 : right.id === winnerId ? 1 : 0) || right.score - left.score ||
    players.indexOf(left) - players.indexOf(right));
}

export function finalTrickPoints(settings?: GameSettings): 2 | 5 {
  return settings?.finalTrickPoints ?? defaultSettings.finalTrickPoints;
}

export function scoreAfter(current: number, change: number, settings: GameSettings): number {
  const total = current + change;
  return settings.allowNegativeScores ? total : Math.max(0, total);
}

/** Apply the penalty to each award before the updated total can reach winner checks. */
export function scoreAfterAward(player: { score: number; hasDeclaredChicago?: boolean }, points: number, settings: GameSettings): number {
  const total = scoreAfter(player.score, points, settings);
  return settings.resetOver52WithoutChicago && total > winningScore && !player.hasDeclaredChicago ? 0 : total;
}

export function canDeclareChicago(score: number): boolean {
  return score >= chicagoThreshold;
}

export function chicagoResult(wonAllTricks: boolean): 15 | -15 {
  return wonAllTricks ? chicagoPoints : -15;
}
