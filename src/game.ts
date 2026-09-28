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
  control: "human" | "bot";
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
export type GameSettings = { finalTrickPoints: 2 | 5; allowNegativeScores: boolean };
export type ChicagoAward = { playerId: string; points: 15 | -15 };
export type ExchangeFeedback = { exchangeCount: 1 | 2 | 3; changedCards: number };
export type GameState = {
  roomCode: string;
  ownerId: string;
  phase: Phase;
  tableStage: TableStage;
  players: Player[];
  deck: Card[];
  discard: Card[];
  activePlayerId: string | null;
  selectedCardIds: string[];
  exchangeCount: ExchangeCount;
  exchangeSubmittedPlayerIds: string[];
  exchangeFeedback: ExchangeFeedback | null;
  handAwards: HandAward[];
  finalHands: Record<string, Card[]> | null;
  finalTrickAward: TrickAward | null;
  settings: GameSettings;
  chicagoPlayerId: string | null;
  chicagoBreakerId: string | null;
  chicagoAward: ChicagoAward | null;
  activity: string[];
  currentTrick: PlayedCard[];
  completedTricks: CompletedTrick[];
  waitingForNextTrick: boolean;
  trickError: string | null;
};

export function playedCardsForPlayer(game: Pick<GameState, "completedTricks" | "currentTrick">, playerId: string): Card[] {
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
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function finalTrickPoints(settings?: GameSettings): 2 | 5 {
  return settings?.finalTrickPoints ?? 5;
}

function addPoints(game: GameState, players: Player[], playerId: string, points: number): Player[] {
  return players.map((player) => player.id === playerId ? {
    ...player, score: game.settings?.allowNegativeScores
      ? player.score + points : Math.max(0, player.score + points),
  } : player);
}

export function createRoom(
  name: string,
  roomCode: string,
  playerId: string = crypto.randomUUID(),
): GameState {
  const local: Player = {
    id: playerId,
    name: name.trim(),
    control: "human",
    score: 0,
    hand: [],
  };
  return {
    roomCode,
    ownerId: playerId,
    phase: "lobby",
    tableStage: "exchange",
    players: [local],
    deck: createDeck(),
    discard: [],
    activePlayerId: null,
    selectedCardIds: [],
    exchangeCount: 0,
    exchangeSubmittedPlayerIds: [],
    exchangeFeedback: null,
    handAwards: [],
    finalHands: null,
    finalTrickAward: null,
    settings: { finalTrickPoints: 5, allowNegativeScores: false },
    chicagoPlayerId: null,
    chicagoBreakerId: null,
    chicagoAward: null,
    activity: [],
    currentTrick: [],
    completedTricks: [],
    waitingForNextTrick: false,
    trickError: null,
  };
}

export function addDemoPlayer(game: GameState): GameState {
  if (game.phase !== "lobby" || game.players.length >= 4) return game;
  let botNumber = 1;
  while (game.players.some((player) => player.id === `demo-${botNumber}`)) botNumber++;
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
        id: `demo-${botNumber}`,
        name,
        control: "bot",
        score: 0,
        hand: [],
      },
    ],
  };
}

export function startRound(game: GameState): GameState {
  if (game.players.length < 2 || (game.phase !== "lobby" && game.tableStage !== "result")) return game;
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
    exchangeSubmittedPlayerIds: [],
    exchangeFeedback: null,
    handAwards: [],
    finalHands: null,
    finalTrickAward: null,
    chicagoPlayerId: null,
    chicagoBreakerId: null,
    chicagoAward: null,
    activity: [],
    currentTrick: [],
    completedTricks: [],
    waitingForNextTrick: false,
    trickError: null,
  };
}

export function toggleCard(game: GameState, cardId: string): GameState {
  if (game.phase !== "table" || game.tableStage !== "exchange") return game;
  const localHand = game.players.find((player) => player.id === game.ownerId)?.hand ?? [];
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
    players: winnerId ? addPoints(game, game.players, winnerId, points) : game.players,
    handAwards: [...game.handAwards, award],
    activity: [...game.activity, winnerId
      ? `${best!.name} har bäst hand efter byte ${exchangeCount}: ${evaluations[winnerId].label} (+${points} p)`
      : `Ingen fick poäng för handen efter byte ${exchangeCount}`],
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
    game.players.find((player) => player.id === game.ownerId)?.hand.length === 5 &&
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
  for (const player of game.players.filter((candidate) => candidate.control === "bot")) {
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
    activePlayerId: next.ownerId,
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
    activity: [...exchanged.activity, "Kortbytena är klara · nu börjar sticken"],
  });
}

export function exchangeSelectedCards(game: GameState): GameState {
  if (!canFinishExchange(game) || game.selectedCardIds.length === 0)
    return game;
  const local = game.players.find((player) => player.id === game.ownerId);
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
  const local = game.players.find((player) => player.id === game.ownerId);
  return finishExchange({
    ...game,
    exchangeFeedback: { exchangeCount: nextExchangeCount(game.exchangeCount), changedCards: 0 },
    activity: [...game.activity, `${local?.name ?? "Du"} behåller handen`],
  });
}

export function selectTrickCard(game: GameState, cardId: string): GameState {
  if (
    game.phase !== "table" || game.tableStage !== "tricks" || game.waitingForNextTrick ||
    game.ownerId !== game.activePlayerId
  ) return game;
  const hand = game.players.find((player) => player.id === game.ownerId)!.hand;
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
  const firstBreak = game.chicagoPlayerId && winnerId !== game.chicagoPlayerId && !game.chicagoBreakerId;
  const chicagoBreakerId = firstBreak ? winnerId : game.chicagoBreakerId;
  const scoredPlayers = firstBreak ? addPoints(game, players, winnerId, 10) : players;
  const breakActivity = firstBreak ? [`${winnerName} bröt Chicago (+10 p)`] : [];
  if (completedTricks.length === 5) {
    const points = finalTrickPoints(game.settings);
    const chicagoAward: ChicagoAward | null = game.chicagoPlayerId
      ? { playerId: game.chicagoPlayerId, points: chicagoBreakerId ? -15 : 15 } : null;
    const withFinalTrick = addPoints(game, scoredPlayers, winnerId, points);
    const withChicago = chicagoAward
      ? addPoints(game, withFinalTrick, chicagoAward.playerId, chicagoAward.points) : withFinalTrick;
    const afterTrick: GameState = {
      ...game,
      players: withChicago,
      chicagoBreakerId,
      chicagoAward,
      currentTrick: [],
      completedTricks,
      activePlayerId: null,
      tableStage: "result",
      selectedCardIds: [],
      trickError: null,
      finalTrickAward: { winnerId, points },
      activity: [...activity, ...breakActivity, `${winnerName} vann sista sticket (+${points} p)`,
        ...(chicagoAward ? [`${players.find((p) => p.id === chicagoAward.playerId)!.name} ${chicagoAward.points > 0 ? "vann" : "förlorade"} Chicago (${chicagoAward.points > 0 ? "+" : ""}${chicagoAward.points} p)`] : [])],
    };
    return afterTrick.finalHands
      ? scorePokerHands(afterTrick, 3, afterTrick.finalHands)
      : afterTrick;
  }
  return {
    ...game,
    players: scoredPlayers,
    chicagoBreakerId,
    currentTrick: [],
    completedTricks,
    activePlayerId: winnerId,
    tableStage: "tricks",
    waitingForNextTrick: true,
    selectedCardIds: [],
    trickError: null,
    activity: [...activity, ...breakActivity, `${winnerName} vann stick ${completedTricks.length}`],
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
  if (!player || player.control !== "bot") return game;
  const card = chooseBotTrickCard(player.hand, game.currentTrick[0]?.card.suit ?? null);
  return playCard(game, player.id, card.id);
}

export function playSelectedTrickCardOnce(game: GameState): GameState {
  if (game.phase !== "table" || game.tableStage !== "tricks" || game.waitingForNextTrick) return game;
  const local = game.players.find((player) => player.id === game.ownerId);
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
  const local = game.players.find((player) => player.id === game.ownerId);
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
    () => alphabet[crypto.getRandomValues(new Uint32Array(1))[0] % alphabet.length],
  ).join("");
}

export type GameCommand =
  | { type: "set-settings"; actorId: string; settings: GameSettings }
  | { type: "declare-chicago"; actorId: string }
  | { type: "add-human"; actorId: string; playerId: string; name: string }
  | { type: "add-bot"; actorId: string }
  | { type: "remove-player"; actorId: string; playerId: string }
  | { type: "start-round"; actorId: string }
  | { type: "return-lobby"; actorId: string }
  | { type: "exchange"; actorId: string; discardIds: string[] }
  | { type: "play-card"; actorId: string; cardId: string }
  | { type: "advance-bot"; actorId: string }
  | { type: "continue-trick"; actorId: string };

/** Returns the original state for a rejected command. Only the room owner drives shared timing. */
export function applyCommand(game: GameState, command: GameCommand): GameState {
  const actor = game.players.find((player) => player.id === command.actorId);
  if (!actor || actor.control !== "human") return game;
  switch (command.type) {
    case "set-settings":
      if (command.actorId !== game.ownerId || game.phase !== "lobby" ||
        !command.settings || ![2, 5].includes(command.settings.finalTrickPoints) ||
        typeof command.settings.allowNegativeScores !== "boolean") return game;
      return { ...game, settings: { ...command.settings },
        players: command.settings.allowNegativeScores ? game.players : game.players.map((player) => ({
          ...player, score: Math.max(0, player.score),
        })) };
    case "declare-chicago":
      if (game.phase !== "table" || game.tableStage !== "tricks" ||
        game.currentTrick.length || game.completedTricks.length || game.chicagoPlayerId || actor.score < 15) return game;
      return { ...game, chicagoPlayerId: actor.id,
        activity: [...game.activity, `${actor.name} säger Chicago – måste vinna alla stick`] };
    case "add-human":
      if (command.actorId !== game.ownerId || game.phase !== "lobby" || game.players.length >= 4 ||
        typeof command.playerId !== "string" || !command.playerId || typeof command.name !== "string" ||
        !command.name.trim() || game.players.some((p) => p.id === command.playerId)) return game;
      return { ...game, players: [...game.players, { id: command.playerId, name: command.name.trim(), control: "human", score: 0, hand: [] }] };
    case "add-bot":
      return command.actorId === game.ownerId ? addDemoPlayer(game) : game;
    case "remove-player":
      if (game.phase !== "lobby" || (command.actorId !== command.playerId && command.actorId !== game.ownerId)) return game;
      const players = game.players.filter((p) => p.id !== command.playerId);
      if (players.length === game.players.length) return game;
      if (command.playerId === game.ownerId && !players.some((p) => p.control === "human"))
        return { ...game, players: [], ownerId: "" };
      return { ...game, players, ownerId: command.playerId === game.ownerId
        ? players.find((p) => p.control === "human")!.id : game.ownerId };
    case "start-round":
      return command.actorId === game.ownerId || (game.phase === "table" && game.tableStage === "result")
        ? startRound(game) : game;
    case "return-lobby":
      return command.actorId === game.ownerId && game.phase === "table"
        ? { ...game, phase: "lobby", selectedCardIds: [], exchangeSubmittedPlayerIds: [] } : game;
    case "exchange": {
      if (game.phase !== "table" || game.tableStage !== "exchange" || game.exchangeCount >= 3 ||
        !Array.isArray(command.discardIds) || command.discardIds.length > 5 ||
        !command.discardIds.every((id) => typeof id === "string") ||
        game.exchangeSubmittedPlayerIds.includes(actor.id) || actor.hand.length !== 5 || !validCardZones(game)) return game;
      const exchanged = exchangePlayerCards(game, actor.id, command.discardIds);
      if (exchanged === game) return game;
      const submitted = [...game.exchangeSubmittedPlayerIds, actor.id];
      let next: GameState = { ...exchanged, exchangeSubmittedPlayerIds: submitted,
        activity: [...exchanged.activity, command.discardIds.length
          ? `${actor.name} byter ${command.discardIds.length} kort` : `${actor.name} behåller handen`] };
      if (game.players.some((p) => p.control === "human" && !submitted.includes(p.id))) return next;
      for (const bot of game.players.filter((p) => p.control === "bot")) {
        const botHand = next.players.find((p) => p.id === bot.id)!.hand;
        next = exchangePlayerCards(next, bot.id, chooseBotDiscards(botHand));
      }
      next = { ...next, exchangeSubmittedPlayerIds: [], exchangeCount: nextExchangeCount(game.exchangeCount), selectedCardIds: [] };
      if (next.exchangeCount === 1 || next.exchangeCount === 2) return scorePokerHands(next, next.exchangeCount,
        Object.fromEntries(next.players.map((p) => [p.id, p.hand])));
      return { ...next, finalHands: Object.fromEntries(next.players.map((p) => [p.id, [...p.hand]])),
        tableStage: "tricks", activePlayerId: next.players[0].id,
        activity: [...next.activity, "Kortbytena är klara · nu börjar sticken"] };
    }
    case "play-card":
      return actor.id === game.activePlayerId && game.phase === "table" ? playCard(game, actor.id, command.cardId) : game;
    case "advance-bot":
      return command.actorId === game.ownerId ? playNextDemoTrickCard(game) : game;
    case "continue-trick":
      return command.actorId === game.ownerId ? continueAfterTrickOnce(game) : game;
  }
}

export type PlayerView = Omit<Player, "hand"> & { hand: Card[]; handCount: number };
export type GameView = Omit<GameState, "deck" | "discard" | "players" | "finalHands" | "selectedCardIds" | "trickError" | "exchangeFeedback"> & {
  players: PlayerView[];
  deckCount: number;
  discardCount: number;
  revision?: number;
  selectedCardIds: string[];
  trickError: string | null;
  exchangeFeedback: ExchangeFeedback | null;
};

/** Construct explicitly so new authority fields cannot silently enter client snapshots. */
export function viewForPlayer(game: GameState, viewerId: string): GameView | null {
  if (!game.players.some((p) => p.id === viewerId)) return null;
  const revealed = game.tableStage === "result";
  return {
    roomCode: game.roomCode, ownerId: game.ownerId, phase: game.phase, tableStage: game.tableStage,
    players: game.players.map((p) => ({ id: p.id, name: p.name, control: p.control, score: p.score,
      hand: p.id === viewerId ? [...p.hand] : [], handCount: p.hand.length })),
    deckCount: game.deck.length, discardCount: game.discard.length,
    activePlayerId: game.activePlayerId, selectedCardIds: [], exchangeCount: game.exchangeCount,
    exchangeSubmittedPlayerIds: [...game.exchangeSubmittedPlayerIds], exchangeFeedback: null,
    handAwards: game.handAwards.map((award) => ({ ...award, evaluations: revealed ? award.evaluations : {} })),
    finalTrickAward: game.finalTrickAward, activity: [...game.activity],
    settings: game.settings ?? { finalTrickPoints: 5, allowNegativeScores: false },
    chicagoPlayerId: game.chicagoPlayerId ?? null,
    chicagoBreakerId: game.chicagoBreakerId ?? null,
    chicagoAward: game.chicagoAward ?? null,
    currentTrick: game.currentTrick.map((played) => ({ ...played })),
    completedTricks: game.completedTricks.map((trick) => ({ winnerId: trick.winnerId,
      cards: trick.cards.map((played) => ({ ...played })) })),
    waitingForNextTrick: game.waitingForNextTrick, trickError: null,
  };
}
