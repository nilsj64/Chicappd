import type { GameView, GameSettings, CompletedTrick } from "./game.ts";
import type { HistoryOptions } from "./history.ts";
import { validSettings } from "./scoring.ts";

export type DigitalHistory = {
  kind: "digital"; phase: "result"; source: "local" | "online"; roomCode: string; sourceRevision: number | null;
  players: { id: string; name: string; score: number; hasDeclaredChicago: boolean }[];
  settings: GameSettings;
  history: { tricks: CompletedTrick[]; handAwards: { exchangeCount: number; winnerId: string | null; points: number }[];
    finalTrickAward: { winnerId: string; points: number } | null; chicagoAward: { playerId: string; points: number } | null }[];
};

export function digitalResult(view: GameView, source: DigitalHistory["source"]): DigitalHistory | null {
  if (view.phase !== "table" || view.tableStage !== "result" || view.completedTricks.length !== 5) return null;
  // Explicit public result projection, identical for all seats. No live state,
  // private hands/deck, temporary seat credentials or viewer-specific fields.
  return {
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
    typeof g.roomCode === "string" && (g.sourceRevision === null || Number.isSafeInteger(g.sourceRevision)) && validSettings(g.settings) &&
    Array.isArray(g.players) && g.players.length >= 2 && g.players.length <= 4 &&
    g.players.every(p => p && typeof p.id === "string" && typeof p.name === "string" && Number.isSafeInteger(p.score) && typeof p.hasDeclaredChicago === "boolean") &&
    Array.isArray(g.history) && g.history.length === 1 && g.history.every(r => !!r && Array.isArray(r.tricks) && r.tricks.length === 5 &&
      r.tricks.every(t => !!t && typeof t.winnerId === "string" && Array.isArray(t.cards) && t.cards.every(c => !!c && typeof c.playerId === "string" && !!c.card && typeof c.card.id === "string" && ["spades", "hearts", "diamonds", "clubs"].includes(c.card.suit) && ["2","3","4","5","6","7","8","9","10","J","Q","K","A"].includes(c.card.rank))) &&
      Array.isArray(r.handAwards) && r.handAwards.every(a => !!a && Number.isInteger(a.exchangeCount) && (a.winnerId === null || typeof a.winnerId === "string") && Number.isSafeInteger(a.points)) &&
      (r.finalTrickAward === null || (!!r.finalTrickAward && typeof r.finalTrickAward.winnerId === "string" && Number.isSafeInteger(r.finalTrickAward.points))) &&
      (r.chicagoAward === null || (!!r.chicagoAward && typeof r.chicagoAward.playerId === "string" && Number.isSafeInteger(r.chicagoAward.points))));
}

export const digitalHistoryOptions: HistoryOptions<DigitalHistory> = { kind: "digital", archive: true, guestKey: "chicappd-digital-history", cachePrefix: "chicappd-digital-history-", validate: validDigitalHistory };

export async function digitalResultId(result: DigitalHistory): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(result)));
  const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
