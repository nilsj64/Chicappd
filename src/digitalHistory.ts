import type { GameView, GameSettings, CompletedTrick } from "./game.ts";
import type { HistoryOptions } from "./history.ts";
import { digitalMatchWinnerId } from "./game.ts";
import { evaluateHand, compareHands, handCategories, isRoyalFlush } from "./poker.ts";
import type { HandEvaluation } from "./poker.ts";
import type { HistoryRecord } from "./history.ts";
import { validSettings } from "./scoring.ts";

export type DigitalHistory = {
  kind: "digital"; phase: "result"; source: "local" | "online"; roomCode: string; sourceRevision: number | null;
  playerId?: string;
  matchId?: string;
  dealNumber?: number;
  winnerId?: string | null;
  royalFlushWinnerId?: string | null;
  // Evaluations are revealed at result time; no private cards are stored here.
  evaluations?: Record<string, HandEvaluation[]>;
  players: { id: string; name: string; score: number; hasDeclaredChicago: boolean }[];
  settings: GameSettings;
  history: { tricks: CompletedTrick[]; handAwards: { exchangeCount: number; winnerId: string | null; points: number }[];
    finalTrickAward: { winnerId: string; points: number } | null; chicagoAward: { playerId: string; points: number } | null }[];
};

export function digitalResult(view: GameView, source: DigitalHistory["source"], playerId?: string): DigitalHistory | null {
  if (view.phase !== "table" || view.tableStage !== "result" || (view.completedTricks.length !== 5 && !view.royalFlushWinnerId)) return null;
  // Explicit public result projection, identical for all seats. No live state,
  // private hands/deck, temporary seat credentials or viewer-specific fields.
  return {
    ...(playerId ? { playerId } : {}),
    ...(view.matchId ? { matchId: view.matchId, dealNumber: view.dealNumber } : {}),
    winnerId: digitalMatchWinnerId(view), royalFlushWinnerId: view.royalFlushWinnerId ?? null,
    evaluations: Object.fromEntries(view.players.map(p => [p.id, [...(view.initialHandEvaluations?.[p.id] ? [view.initialHandEvaluations[p.id]] : []), ...view.handAwards.flatMap(a => a.evaluations[p.id] ? [a.evaluations[p.id]] : [])]])),
    kind: "digital", phase: "result", source, roomCode: view.roomCode, sourceRevision: source === "online" ? view.revision ?? null : null,
    players: view.players.map(p => ({ id: p.id, name: p.name, score: p.score, hasDeclaredChicago: p.hasDeclaredChicago })),
    settings: { ...view.settings },
    history: [{ tricks: view.completedTricks.map(t => ({ winnerId: t.winnerId, cards: t.cards.map(c => ({ playerId: c.playerId, card: { id: c.card.id, suit: c.card.suit, rank: c.card.rank } })) })),
      handAwards: view.handAwards.map(a => ({ exchangeCount: a.exchangeCount, winnerId: a.winnerId, points: a.points })),
      finalTrickAward: view.finalTrickAward && { winnerId: view.finalTrickAward.winnerId, points: view.finalTrickAward.points },
      chicagoAward: view.chicagoAward && { playerId: view.chicagoAward.playerId, points: view.chicagoAward.points } }],
  };
}

export function validDigitalHistory(value: unknown): value is DigitalHistory {
  const g = value as DigitalHistory | null;
  return !!g && g.kind === "digital" && g.phase === "result" && ["local", "online"].includes(g.source) &&
    Array.isArray(g.players) && g.players.length >= 2 && g.players.length <= 6 &&
    g.players.every(p => p && typeof p.id === "string" && typeof p.name === "string" && Number.isSafeInteger(p.score) && typeof p.hasDeclaredChicago === "boolean") &&
    (g.playerId === undefined || g.players?.some(p => p.id === g.playerId)) &&
    (g.matchId === undefined || (typeof g.matchId === "string" && Number.isSafeInteger(g.dealNumber) && g.dealNumber! > 0)) &&
    [g.winnerId, g.royalFlushWinnerId].every(id => id === undefined || id === null || g.players?.some(p => p.id === id)) &&
    (g.evaluations === undefined || (!!g.evaluations && typeof g.evaluations === "object" && Object.entries(g.evaluations).every(([id, values]) =>
      g.players?.some(p => p.id === id) && Array.isArray(values) && values.every(validEvaluation)))) &&
    typeof g.roomCode === "string" && (g.sourceRevision === null || Number.isSafeInteger(g.sourceRevision)) && validSettings(g.settings) &&
    Array.isArray(g.history) && g.history.length === 1 && g.history.every(r => !!r && Array.isArray(r.tricks) && (r.tricks.length === 5 || (r.tricks.length === 0 && !!g.royalFlushWinnerId && g.winnerId === g.royalFlushWinnerId && !!g.evaluations?.[g.royalFlushWinnerId]?.some(isRoyalFlush))) &&
      r.tricks.every(t => !!t && typeof t.winnerId === "string" && Array.isArray(t.cards) && t.cards.every(c => !!c && typeof c.playerId === "string" && !!c.card && typeof c.card.id === "string" && ["spades", "hearts", "diamonds", "clubs"].includes(c.card.suit) && ["2","3","4","5","6","7","8","9","10","J","Q","K","A"].includes(c.card.rank))) &&
      Array.isArray(r.handAwards) && r.handAwards.every(a => !!a && Number.isInteger(a.exchangeCount) && (a.winnerId === null || typeof a.winnerId === "string") && Number.isSafeInteger(a.points)) &&
      (r.finalTrickAward === null || (!!r.finalTrickAward && typeof r.finalTrickAward.winnerId === "string" && Number.isSafeInteger(r.finalTrickAward.points))) &&
      (r.chicagoAward === null || (!!r.chicagoAward && typeof r.chicagoAward.playerId === "string" && Number.isSafeInteger(r.chicagoAward.points))));
}

export const digitalHistoryOptions: HistoryOptions<DigitalHistory> = { kind: "digital", archive: true, guestKey: "chicappd-digital-history", cachePrefix: "chicappd-digital-history-", validate: validDigitalHistory };

export async function digitalResultId(result: DigitalHistory): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(result.matchId
    ? { source: result.source, matchId: result.matchId, dealNumber: result.dealNumber, playerId: result.playerId }
    : { kind: result.kind, phase: result.phase, source: result.source, roomCode: result.roomCode, sourceRevision: result.sourceRevision,
      players: result.players, settings: result.settings, history: result.history })));
  const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function validEvaluation(value: unknown): value is HandEvaluation {
  const e = value as HandEvaluation | null;
  return !!e && handCategories.includes(e.category) && e.strength === handCategories.indexOf(e.category) &&
    Array.isArray(e.tiebreakers) && e.tiebreakers.length > 0 && e.tiebreakers.every(r => Number.isInteger(r) && r >= 2 && r <= 14) && typeof e.label === "string";
}

/** Old public trick records retain every player's final five-card poker hand. */
function finalEvaluation(game: DigitalHistory, playerId: string): HandEvaluation | null {
  const recorded = game.evaluations?.[playerId]?.at(-1);
  if (recorded) return recorded;
  const cards = game.history[0].tricks.flatMap(t => t.cards.filter(c => c.playerId === playerId).map(c => c.card));
  try { return evaluateHand(cards); } catch { return null; }
}

export function digitalStatistics(records: readonly HistoryRecord<DigitalHistory>[], username?: string) {
  let gamesPlayed = 0, wins = 0, losses = 0, currentStreak = 0, longestStreak = 0;
  let bestScore: number | null = null, scoreTotal = 0, scoredDeals = 0, bestHand: HandEvaluation | null = null, unassigned = 0;
  const handCounts: Record<string, number> = Object.fromEntries([...handCategories, "royal-flush"].map(c => [c, 0]));
  const recent: ("win" | "loss")[] = [];
  const seenDeals = new Set<string>(), seenMatches = new Set<string>();
  for (const record of [...records].sort((a,b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id))) {
    const g = record.game;
    // Old local rooms always started with the local player in seat one. For old
    // online records, only an unambiguous account name identifies the seat.
    const named = username ? g.players.filter(p => p.name.toLowerCase() === username.toLowerCase()) : [];
    const playerId = g.playerId ?? (g.source === "local" ? g.players[0].id : named.length === 1 ? named[0].id : null);
    const player = g.players.find(p => p.id === playerId);
    if (!player) { unassigned++; continue; }
    const dealKey = g.matchId ? `${g.source}:${g.matchId}:${g.dealNumber}:${player.id}` : record.id;
    if (seenDeals.has(dealKey)) continue;
    seenDeals.add(dealKey);
    bestScore = bestScore === null ? player.score : Math.max(bestScore, player.score);
    scoreTotal += player.score; scoredDeals++;
    const final = finalEvaluation(g, player.id);
    if (final) handCounts[isRoyalFlush(final) ? "royal-flush" : final.category]++;
    for (const hand of [...(g.evaluations?.[player.id] ?? []), ...(final ? [final] : [])]) {
      if (!bestHand || compareHands(hand, bestHand) > 0) bestHand = hand;
    }
    const winnerId = g.winnerId === undefined ? digitalMatchWinnerId(g) : g.winnerId;
    if (!winnerId) continue; // A finished deal is not a decided match or a draw.
    const matchKey = g.matchId ? `${g.source}:${g.matchId}:${player.id}` : record.id;
    if (seenMatches.has(matchKey)) continue;
    seenMatches.add(matchKey); gamesPlayed++;
    if (winnerId === player.id) { wins++; currentStreak++; longestStreak = Math.max(longestStreak, currentStreak); recent.push("win"); }
    else { losses++; currentStreak = 0; recent.push("loss"); }
  }
  return { gamesPlayed, wins, losses, winPercentage: gamesPlayed ? wins / gamesPlayed * 100 : 0,
    currentStreak, longestStreak, bestScore, averageScore: scoredDeals ? scoreTotal / scoredDeals : null,
    bestHand, royalFlushes: handCounts["royal-flush"], handCounts, recent: recent.slice(-10), scoredDeals, unassigned };
}
