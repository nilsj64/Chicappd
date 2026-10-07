import type { Card, ExchangeEvent, GameView } from "./game";

export type CardRect = { x: number; y: number; width: number; height: number };
export type Replacement = { card?: Card; slot: number };
export type ExchangePlayback = {
  event: ExchangeEvent;
  sources: CardRect[];
  replacements: Replacement[];
  reducedMotion: boolean;
};

/** Retained cards keep their visual slots. Fill vacancies with the actual new
 * cards, in deck order, without changing the authoritative hand or card objects. */
export function exchangeHandSlots(previous: readonly Card[], next: readonly Card[]) {
  const nextIds = new Set(next.map(card => card.id));
  const previousIds = new Set(previous.map(card => card.id));
  const received = next.filter(card => !previousIds.has(card.id));
  const discarded = previous.filter(card => !nextIds.has(card.id));
  if (previous.length !== next.length) return { hand: [...next], discarded, replacements: [] };
  let incoming = 0;
  const replacements: Replacement[] = [];
  const hand = previous.map((card, slot) => {
    if (nextIds.has(card.id)) return next.find(candidate => candidate.id === card.id)!;
    const replacement = received[incoming++];
    replacements.push({ card: replacement, slot });
    return replacement;
  });
  return { hand, discarded, replacements };
}

export const replacementKey = (eventId: number, cardId: string) => `${eventId}:${cardId}`;

/** Authority may advance in a batch; the table follows the oldest unfinished
 * exchange, including events not yet captured by the layout effect. */
export function exchangeDisplayState(game: Pick<GameView,
  "tableStage" | "pendingExchange" | "activePlayerId" | "exchangeCount" | "exchangeEvents">,
  queue: readonly Pick<ExchangePlayback, "event">[], seenEventId: number) {
  const event = queue[0]?.event ?? game.exchangeEvents.find(event => event.id > seenEventId);
  const busy = !!event;
  return {
    busy,
    exchanging: game.tableStage === "exchange" || busy,
    pendingExchange: busy ? null : game.pendingExchange,
    activePlayerId: event?.playerId ?? game.activePlayerId,
    exchangeCount: event ? event.exchangeCount - 1 : game.exchangeCount,
  };
}
