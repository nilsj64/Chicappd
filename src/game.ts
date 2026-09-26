import { compareHands, evaluateHand } from "./poker.ts";
import type { HandEvaluation } from "./poker.ts";
import { chooseBotDiscards, chooseBotTrickCard } from "./bot.ts";
import { legalCards, trickWinner } from "./tricks.ts";
import type { PlayedCard } from "./tricks.ts";

export const suits = ["spades", "hearts", "diamonds", "clubs"] as const;
export const ranks = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
] as const;

export type Suit = (typeof suits)[number];
export type Rank = (typeof ranks)[number];
export type Card = { id: string; suit: Suit; rank: Rank };
export type Player = {
  id: string;
  name: string;
  isLocal: boolean;
  score: number;
  hand: Card[];
};
export type Phase = "lobby" | "table";
export type TableStage = "exchange" | "tricks" | "result";
export type ExchangeCount = 0 | 1 | 2 | 3;
export type CompletedTrick = { cards: PlayedCard[]; winnerId: string };
export type HandAward = {
  exchangeCount: 1 | 2 | 3;
  evaluations: Record<string, HandEvaluation>;
  winnerId: string | null;
  points: number;
};
export type TrickAward = { winnerId: string; points: number };
export type ExchangeFeedback = { exchangeCount: 1 | 2 | 3; changedCards: number };
export type GameState = {
  roomCode: string;
  phase: Phase;
  tableStage: TableStage;
  players: Player[];
  deck: Card[];
  discard: Card[];
  activePlayerId: string | null;
  selectedCardIds: string[];
  exchangeCount: ExchangeCount;
  exchangeFeedback: ExchangeFeedback | null;
  handAwards: HandAward[];
  finalHands: Record<string, Card[]> | null;
  finalTrickAward: TrickAward | null;
  activity: string[];
  currentTrick: PlayedCard[];
  completedTricks: CompletedTrick[];
  waitingForNextTrick: boolean;
  trickError: string | null;
};

export function playedCardsForPlayer(game: GameState, playerId: string): Card[] {
  return [
    ...game.completedTricks.flatMap((trick) =>
      trick.cards.filter((played) => played.playerId === playerId).map((played) => played.card),
    ),
    ...game.currentTrick.filter((played) => played.playerId === playerId).map((played) => played.card),
  ];
}

export const suitSymbol: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

export function createDeck(): Card[] {
  return suits.flatMap((suit) =>
    ranks.map((rank) => ({ id: `${suit}-${rank}`, suit, rank })),
  );
}

function shuffled(cards: Card[]): Card[] {
  const next = [...cards];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function finalTrickPoints(): number {
  return 5;
}

export function createRoom(
  name: string,
  roomCode: string,
): GameState {
  const local: Player = {
    id: "local",
    name: name.trim(),
    isLocal: true,
    score: 0,
    hand: [],
  };
  return {
    roomCode,
    phase: "lobby",
    tableStage: "exchange",
    players: [local],
    deck: createDeck(),
    discard: [],
    activePlayerId: null,
    selectedCardIds: [],
    exchangeCount: 0,
    exchangeFeedback: null,
    handAwards: [],
    finalHands: null,
    finalTrickAward: null,
    activity: [],
    currentTrick: [],
    completedTricks: [],
    waitingForNextTrick: false,
    trickError: null,
  };
}

export function addDemoPlayer(game: GameState): GameState {
  if (game.players.length >= 4) return game;
  const names = ["Alex", "Sam", "Kim"];
  const used = new Set(game.players.map((player) => player.name.toLowerCase()));
  const name =
    names.find((candidate) => !used.has(candidate.toLowerCase())) ??
    `Spelare ${game.players.length + 1}`;
  return {
    ...game,
    players: [
      ...game.players,
      {
        id: `demo-${game.players.length}`,
        name,
        isLocal: false,
        score: 0,
        hand: [],
      },
    ],
  };
}

export function startRound(game: GameState): GameState {
  if (game.players.length < 2) return game;
  const deck = shuffled(createDeck());
  const players = game.players.map((player) => ({
    ...player,
    hand: deck.splice(0, 5),
  }));
  return {
    ...game,
    phase: "table",
    tableStage: "exchange",
    players,
    deck,
    discard: [],
    activePlayerId: players[0].id,
    selectedCardIds: [],
    exchangeCount: 0,
    exchangeFeedback: null,
    handAwards: [],
    finalHands: null,
    finalTrickAward: null,
    activity: [],
    currentTrick: [],
    completedTricks: [],
    waitingForNextTrick: false,
    trickError: null,
  };
}

export function toggleCard(game: GameState, cardId: string): GameState {
  if (game.phase !== "table" || game.tableStage !== "exchange") return game;
  const localHand = game.players.find((player) => player.isLocal)?.hand ?? [];
  if (!localHand.some((card) => card.id === cardId)) return game;
  const selected = game.selectedCardIds.includes(cardId)
    ? game.selectedCardIds.filter((id) => id !== cardId)
    : [...game.selectedCardIds, cardId];
  return { ...game, selectedCardIds: selected };
}

function scorePokerHands(
  game: GameState,
  exchangeCount: 1 | 2 | 3,
  hands: Record<string, Card[]>,
): GameState {
  const evaluations = Object.fromEntries(
    game.players.map((player) => [player.id, evaluateHand(hands[player.id])]),
  ) as Record<string, HandEvaluation>;
  const best = game.players.reduce((leader, player) =>
    !leader || compareHands(evaluations[player.id], evaluations[leader.id]) > 0
      ? player : leader, null as Player | null);
  const tied = best && game.players.some((player) =>
    player.id !== best.id && compareHands(evaluations[player.id], evaluations[best.id]) === 0);
  const winnerId = best && !tied && evaluations[best.id].strength > 0 ? best.id : null;
  const points = winnerId ? evaluations[winnerId].strength : 0;
  const award: HandAward = { exchangeCount, evaluations, winnerId, points };
  return {
    ...game,
    players: game.players.map((player) =>
      player.id === winnerId ? { ...player, score: player.score + points } : player),
    handAwards: [...game.handAwards, award],
    activity: [...game.activity, winnerId
      ? `${best!.name} har bäst hand efter byte ${exchangeCount}: ${evaluations[winnerId].label} (+${points} p)`
      : `Ingen handpoäng efter byte ${exchangeCount}`],
  };
}

function validCardZones(game: GameState): boolean {
  const cards = [
    ...game.deck,
    ...game.discard,
    ...game.players.flatMap((player) => player.hand),
    ...game.currentTrick.map((played) => played.card),
    ...game.completedTricks.flatMap((trick) => trick.cards.map((played) => played.card)),
  ];
  return (
    cards.length === 52 &&
    cards.every((card) => card.id === `${card.suit}-${card.rank}`) &&
    new Set(cards.map((card) => card.id)).size === 52
  );
}

function canFinishExchange(game: GameState): boolean {
  return (
    game.phase === "table" &&
    game.tableStage === "exchange" &&
    game.exchangeCount < 3 &&
    game.players.find((player) => player.isLocal)?.hand.length === 5 &&
    validCardZones(game)
  );
}

function nextExchangeCount(count: ExchangeCount): 1 | 2 | 3 {
  return count === 0 ? 1 : count === 1 ? 2 : 3;
}

function exchangePlayerCards(
  game: GameState,
  playerId: string,
  discardedIds: readonly string[],
): GameState {
  const player = game.players.find((candidate) => candidate.id === playerId);
  const selected = new Set(discardedIds);
  if (
    !player || player.hand.length !== 5 ||
    selected.size !== discardedIds.length ||
    !discardedIds.every((id) => player.hand.some((card) => card.id === id)) ||
    game.deck.length + game.discard.length < selected.size
  ) return game;

  // Recycle earlier discards only when needed. Cards discarded in this action
  // cannot be drawn straight back into the same hand.
  const deck = game.deck.length >= selected.size
    ? game.deck
    : [...game.deck, ...shuffled(game.discard)];
  const oldDiscard = game.deck.length >= selected.size ? game.discard : [];
  const discarded = player.hand.filter((card) => selected.has(card.id));
  const kept = player.hand.filter((card) => !selected.has(card.id));
  const replacements = deck.slice(0, selected.size);
  return {
    ...game,
    players: game.players.map((candidate) =>
      candidate.id === playerId
        ? { ...candidate, hand: [...kept, ...replacements] }
        : candidate,
    ),
    deck: deck.slice(selected.size),
    discard: [...oldDiscard, ...discarded],
  };
}

function finishExchange(game: GameState): GameState {
  let next = game;
  for (const player of game.players.filter((candidate) => !candidate.isLocal)) {
    const discardedIds = chooseBotDiscards(next.players.find((p) => p.id === player.id)!.hand);
    const exchanged = exchangePlayerCards(next, player.id, discardedIds);
    if (exchanged === next) return game;
    next = {
      ...exchanged,
      activity: [
        ...exchanged.activity,
        discardedIds.length
          ? `${player.name} byter ${discardedIds.length} kort`
          : `${player.name} behåller handen`,
      ],
    };
  }
  const exchanged: GameState = {
    ...next,
    activePlayerId: next.players.find((player) => player.isLocal)?.id ?? null,
    selectedCardIds: [],
    exchangeCount: nextExchangeCount(game.exchangeCount),
  };
  if (exchanged.exchangeCount === 1 || exchanged.exchangeCount === 2) {
    return scorePokerHands(
      exchanged,
      exchanged.exchangeCount,
      Object.fromEntries(exchanged.players.map((player) => [player.id, player.hand])),
    );
  }
  return runDemoTurns({
    ...exchanged,
    finalHands: Object.fromEntries(exchanged.players.map((player) => [player.id, [...player.hand]])),
    tableStage: "tricks",
    activity: [...exchanged.activity, "Kortbytet är klart · stickspel börjar"],
  });
}

export function exchangeSelectedCards(game: GameState): GameState {
  if (!canFinishExchange(game) || game.selectedCardIds.length === 0)
    return game;
  const local = game.players.find((player) => player.isLocal);
  if (!local) return game;
  const exchanged = exchangePlayerCards(game, local.id, game.selectedCardIds);
  if (exchanged === game) return game;
  return finishExchange({
    ...exchanged,
    exchangeFeedback: { exchangeCount: nextExchangeCount(game.exchangeCount), changedCards: game.selectedCardIds.length },
    activity: [...exchanged.activity, `${local.name} byter ${game.selectedCardIds.length} kort`],
  });
}

export function keepHand(game: GameState): GameState {
  if (!canFinishExchange(game) || game.selectedCardIds.length > 0) return game;
  const local = game.players.find((player) => player.isLocal);
  return finishExchange({
    ...game,
    exchangeFeedback: { exchangeCount: nextExchangeCount(game.exchangeCount), changedCards: 0 },
    activity: [...game.activity, `${local?.name ?? "Du"} behåller handen`],
  });
}

export function selectTrickCard(game: GameState, cardId: string): GameState {
  if (
    game.phase !== "table" || game.tableStage !== "tricks" || game.waitingForNextTrick ||
    !game.players.find((player) => player.isLocal && player.id === game.activePlayerId)
  ) return game;
  const hand = game.players.find((player) => player.isLocal)!.hand;
  const card = hand.find((candidate) => candidate.id === cardId);
  if (!card) return game;
  if (game.selectedCardIds[0] === cardId)
    return { ...game, selectedCardIds: [], trickError: null };
  const ledSuit = game.currentTrick[0]?.card.suit ?? null;
  const legal = legalCards(hand, ledSuit).some((candidate) => candidate.id === cardId);
  return {
    ...game,
    selectedCardIds: [cardId],
    trickError: legal ? null : `Du måste följa ${suitSymbol[ledSuit!]}. Välj ett kort i den färgen.`,
  };
}

function playCard(game: GameState, playerId: string, cardId: string): GameState {
  if (game.tableStage !== "tricks" || game.waitingForNextTrick || game.activePlayerId !== playerId || !validCardZones(game))
    return game;
  const index = game.players.findIndex((player) => player.id === playerId);
  const player = game.players[index];
  const card = player?.hand.find((candidate) => candidate.id === cardId);
  if (!card) return game;
  const ledSuit = game.currentTrick[0]?.card.suit ?? null;
  if (!legalCards(player.hand, ledSuit).some((candidate) => candidate.id === cardId))
    return game;

  const cards = [...game.currentTrick, { playerId, card }];
  const players = game.players.map((candidate) =>
    candidate.id === playerId
      ? { ...candidate, hand: candidate.hand.filter((held) => held.id !== cardId) }
      : candidate,
  );
  const activity = [...game.activity, `${player.name} spelar ${card.rank}${suitSymbol[card.suit]}`];
  if (cards.length < game.players.length)
    return {
      ...game,
      players,
      currentTrick: cards,
      activePlayerId: game.players[(index + 1) % game.players.length].id,
      selectedCardIds: [],
      trickError: null,
      activity,
    };

  const winnerId = trickWinner(cards);
  const completedTricks = [...game.completedTricks, { cards, winnerId }];
  const winnerName = players.find((candidate) => candidate.id === winnerId)!.name;
  if (completedTricks.length === 5) {
    const points = finalTrickPoints();
    const afterTrick: GameState = {
      ...game,
      players: players.map((candidate) => candidate.id === winnerId
        ? { ...candidate, score: candidate.score + points } : candidate),
      currentTrick: [],
      completedTricks,
      activePlayerId: null,
      tableStage: "result",
      selectedCardIds: [],
      trickError: null,
      finalTrickAward: { winnerId, points },
      activity: [...activity, `${winnerName} vinner sista sticket (+${points} p)`],
    };
    return afterTrick.finalHands
      ? scorePokerHands(afterTrick, 3, afterTrick.finalHands)
      : afterTrick;
  }
  return {
    ...game,
    players,
    currentTrick: [],
    completedTricks,
    activePlayerId: winnerId,
    tableStage: "tricks",
    waitingForNextTrick: true,
    selectedCardIds: [],
    trickError: null,
    activity: [...activity, `${winnerName} vinner stick ${completedTricks.length}`],
  };
}

function runDemoTurns(game: GameState): GameState {
  let next = game;
  while (next.tableStage === "tricks" && !next.waitingForNextTrick) {
    const played = playNextDemoTrickCard(next);
    if (played === next) break;
    next = played;
  }
  return next;
}

export function playNextDemoTrickCard(game: GameState): GameState {
  if (game.phase !== "table" || game.tableStage !== "tricks" || game.waitingForNextTrick) return game;
  const player = game.players.find((candidate) => candidate.id === game.activePlayerId);
  if (!player || player.isLocal) return game;
  const card = chooseBotTrickCard(player.hand, game.currentTrick[0]?.card.suit ?? null);
  return playCard(game, player.id, card.id);
}

export function playSelectedTrickCardOnce(game: GameState): GameState {
  if (game.phase !== "table" || game.tableStage !== "tricks" || game.waitingForNextTrick) return game;
  const local = game.players.find((player) => player.isLocal);
  if (!local || game.activePlayerId !== local.id) return game;
  const cardId = game.selectedCardIds[0];
  if (!cardId) return { ...game, trickError: "Välj ett kort att spela." };
  const card = local.hand.find((candidate) => candidate.id === cardId);
  if (!card) return { ...game, selectedCardIds: [], trickError: "Välj ett kort att spela." };
  const ledSuit = game.currentTrick[0]?.card.suit ?? null;
  if (!legalCards(local.hand, ledSuit).some((candidate) => candidate.id === cardId))
    return { ...game, trickError: `Du måste följa ${suitSymbol[ledSuit!]}. Välj ett kort i den färgen.` };
  return playCard(game, local.id, cardId);
}

export function playTrickCardOnce(game: GameState, cardId: string): GameState {
  if (game.phase !== "table" || game.tableStage !== "tricks") return game;
  const local = game.players.find((player) => player.isLocal);
  return local ? playCard(game, local.id, cardId) : game;
}

export function playSelectedTrickCard(game: GameState): GameState {
  return runDemoTurns(playSelectedTrickCardOnce(game));
}

export function continueAfterTrickOnce(game: GameState): GameState {
  if (game.phase !== "table" || game.tableStage !== "tricks" || !game.waitingForNextTrick)
    return game;
  return { ...game, waitingForNextTrick: false };
}

export function continueAfterTrick(game: GameState): GameState {
  return runDemoTurns(continueAfterTrickOnce(game));
}

export function randomRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 5 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
}
