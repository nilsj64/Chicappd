import type { GameSettings } from "./game.ts";
import { handCategoryName, handCategoryPoints } from "./poker.ts";
import type { HandCategory } from "./poker.ts";
import { canDeclareChicago, chicagoBreakPoints, chicagoResult, finalTrickPoints, matchWinnerId, normalizeSettings, scoreAfterAward, validSettings } from "./scoring.ts";

export type IRLPlayer = { id: string; name: string; score: number; hasDeclaredChicago: boolean };
export type HandResult = { playerId: string; category: HandCategory } | null;
export type DealResult = {
  finalHand: HandResult;
  finalTrickWinnerId: string;
  chicagoWon?: boolean;
  breakerId?: string;
};
type IRLSnapshot = {
  players: IRLPlayer[];
  settings: GameSettings;
  dealNumber: number;
  phase: "hands" | "tricks" | "result";
  chicagoPlayerId: string | null;
  lastSummary: string[];
};
export type IRLGame = IRLSnapshot & { history: IRLSnapshot[] };

function snapshot(game: IRLGame): IRLSnapshot {
  const { history: _history, ...current } = game;
  return current;
}

function commit(game: IRLGame, next: IRLSnapshot): IRLGame {
  return { ...next, history: [...game.history, snapshot(game)] };
}

function hasPlayer(game: IRLGame, id: string): boolean {
  return game.players.some((player) => player.id === id);
}

function award(game: IRLGame, players: IRLPlayer[], id: string, points: number): IRLPlayer[] {
  return players.map((player) => player.id === id
    ? { ...player, score: scoreAfterAward(player, points, game.settings) } : player);
}

function validHand(game: IRLGame, hand: HandResult): boolean {
  return !hand || (hasPlayer(game, hand.playerId) && handCategoryPoints(hand.category) > 0);
}

export function createIRLGame(names: string[], settings: GameSettings): IRLGame | null {
  const trimmed = names.map((name) => name.trim());
  if (trimmed.length < 2 || trimmed.length > 4 || trimmed.some((name) => !name || name.length > 20) ||
    new Set(trimmed.map((name) => name.toLocaleLowerCase())).size !== trimmed.length ||
    !validSettings(settings)) return null;
  return { players: trimmed.map((name, index) => ({ id: `irl-${index + 1}`, name, score: 0, hasDeclaredChicago: false })),
    settings: normalizeSettings(settings), dealNumber: 1, phase: "hands", chicagoPlayerId: null,
    lastSummary: [], history: [] };
}

export function recordFirstHands(game: IRLGame, hands: [HandResult, HandResult]): IRLGame {
  if (game.phase !== "hands" || hands.length !== 2 || !hands.every((hand) => validHand(game, hand))) return game;
  let players = game.players;
  const summary: string[] = [];
  hands.forEach((hand, index) => {
    if (!hand) return;
    const points = handCategoryPoints(hand.category);
    players = award(game, players, hand.playerId, points);
    summary.push(`Byte ${index + 1}: ${players.find((p) => p.id === hand.playerId)!.name} hade bästa hand (${handCategoryName[hand.category]}) och fick ${points} poäng`);
  });
  return commit(game, { ...snapshot(game), players, phase: "tricks", lastSummary: summary });
}

export function declareIRLChicago(game: IRLGame, playerId: string): IRLGame {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (game.phase !== "tricks" || game.chicagoPlayerId || !player || !canDeclareChicago(player.score)) return game;
  return commit(game, { ...snapshot(game), chicagoPlayerId: playerId,
    players: game.players.map((candidate) => candidate.id === playerId
      ? { ...candidate, hasDeclaredChicago: true } : candidate) });
}

export function finishIRLDeal(game: IRLGame, result: DealResult): IRLGame {
  if (game.phase !== "tricks" || !validHand(game, result.finalHand) || !hasPlayer(game, result.finalTrickWinnerId)) return game;
  if (game.chicagoPlayerId) {
    if (typeof result.chicagoWon !== "boolean" ||
      (result.chicagoWon && (result.breakerId || result.finalTrickWinnerId !== game.chicagoPlayerId)) ||
      (!result.chicagoWon && (!result.breakerId || !hasPlayer(game, result.breakerId) || result.breakerId === game.chicagoPlayerId))) return game;
  } else if (result.chicagoWon !== undefined || result.breakerId) return game;

  let players = award(game, game.players, result.finalTrickWinnerId, finalTrickPoints(game.settings));
  const summary = [...game.lastSummary, `Sista sticket: ${players.find((p) => p.id === result.finalTrickWinnerId)!.name} +${finalTrickPoints(game.settings)} enligt regeln för sista sticket`];
  if (game.chicagoPlayerId) {
    if (result.breakerId) {
      players = award(game, players, result.breakerId, chicagoBreakPoints);
      summary.push(`Bröt Chicago: ${players.find((p) => p.id === result.breakerId)!.name} +${chicagoBreakPoints}`);
    }
    const points = chicagoResult(result.chicagoWon!);
    players = award(game, players, game.chicagoPlayerId, points);
    summary.push(`Chicago: ${players.find((p) => p.id === game.chicagoPlayerId)!.name} ${points > 0 ? "+" : ""}${points}`);
  }
  if (result.finalHand) {
    const points = handCategoryPoints(result.finalHand.category);
    players = award(game, players, result.finalHand.playerId, points);
    summary.push(`Sluthand: ${players.find((p) => p.id === result.finalHand!.playerId)!.name} hade bästa hand (${handCategoryName[result.finalHand.category]}) och fick ${points} poäng`);
  }
  return commit(game, { ...snapshot(game), players, phase: "result", lastSummary: summary });
}

export function nextIRLDeal(game: IRLGame): IRLGame {
  return game.phase === "result" && !matchWinnerId(game.players, game.settings) ? commit(game, { ...snapshot(game), dealNumber: game.dealNumber + 1,
    phase: "hands", chicagoPlayerId: null, lastSummary: [] }) : game;
}

export function correctIRLScore(game: IRLGame, playerId: string, newScore: number): IRLGame {
  if (!hasPlayer(game, playerId) || !Number.isSafeInteger(newScore) ||
    (!game.settings.allowNegativeScores && newScore < 0)) return game;
  return commit(game, { ...snapshot(game), players: game.players.map((player) => player.id === playerId
    ? { ...player, score: newScore } : player),
    lastSummary: [...game.lastSummary, `Korrigering: ${game.players.find((p) => p.id === playerId)!.name} till ${newScore}`] });
}

export function undoIRL(game: IRLGame): IRLGame {
  const previous = game.history.at(-1);
  return previous ? { ...previous, history: game.history.slice(0, -1) } : game;
}
