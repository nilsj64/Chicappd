import type { Card, GameView } from "./game.ts";
import { finalTrickPoints, suitSymbol } from "./game.ts";
import { chooseBotDiscards } from "./bot.ts";
import { evaluateHand } from "./poker.ts";
import { cardValue, legalCards, trickWinner } from "./tricks.ts";

export type SupportTip = { cardIds: string[]; text: string };
export type SupportAdvice = { context: string; tips: SupportTip[] };

function cardsText(cards: readonly Card[]): string {
  return cards.map((card) => `${card.rank}${suitSymbol[card.suit]}`).join(", ");
}

/** Uses only the same projected information the player sees at the table. */
export function supportAdvice(view: GameView, viewerId: string): SupportAdvice {
  const player = view.players.find((candidate) => candidate.id === viewerId);
  if (!player || view.phase !== "table") return { context: "", tips: [] };

  if (view.tableStage === "exchange") {
    const hand = player.hand;
    if (hand.length !== 5) return { context: "Vänta på att korten delas ut.", tips: [] };
    if (view.exchangeSubmittedPlayerIds.includes(viewerId)) return {
      context: `Kortbyte ${view.exchangeCount + 1} av 3. Du är klar; vänta på de andra spelarna.`,
      tips: [],
    };
    const evaluation = evaluateHand(hand);
    const discards = new Set(chooseBotDiscards(hand));
    const keep = hand.filter((card) => !discards.has(card.id));
    const change = hand.filter((card) => discards.has(card.id));
    const context = `Kortbyte ${view.exchangeCount + 1} av 3. Bästa handen ger poäng efter första och andra bytet. Händerna vid rundans slut jämförs efter sticken. Välj kort att byta eller behåll handen.`;
    if (!change.length) return { context, tips: [{ cardIds: keep.map((card) => card.id), text: `${evaluation.label}: behåll gärna alla fem kort. En färdig kombination är värd att skydda.` }] };
    const made = evaluation.strength > 0;
    return { context, tips: [
      { cardIds: keep.map((card) => card.id), text: `Behåll gärna ${cardsText(keep)}: ${made ? `${evaluation.label} bygger på dessa kort.` : "det är dina högsta kort just nu."}` },
      { cardIds: change.map((card) => card.id), text: `Överväg att byta ${cardsText(change)}: ${made ? "de behövs inte för din nuvarande kombination." : "lägre kort ger utrymme att förbättra handen."}` },
    ] };
  }

  if (view.tableStage === "result") return {
    context: `Rundan är slut. Bästa handen efter första och andra bytet och vid rundans slut gav poäng. Sista sticket gav ${finalTrickPoints(view.settings)} poäng.`,
    tips: [],
  };

  const last = view.completedTricks.length === 4;
  const led = view.currentTrick[0]?.card.suit ?? null;
  const context = `${last ? `Sista sticket ger ${finalTrickPoints(view.settings)} poäng. ` : "De första fyra sticken ger inga poäng. "}${led ? `Du måste följa ${suitSymbol[led]} om du kan. Bara kort i den färgen kan vinna sticket.` : "Den som spelar ut bestämmer färg. Högsta kortet i den färgen vinner."}`;
  if (view.waitingForNextTrick || view.activePlayerId !== viewerId || !player.hand.length)
    return { context, tips: [{ cardIds: [], text: "Vänta på din tur. Den som vinner sticket spelar ut i nästa." }] };

  const legal = legalCards(player.hand, led).sort((a, b) => cardValue(a) - cardValue(b));
  const low = legal[0];
  if (!low) return { context, tips: [] };
  if (!led) {
    const high = legal.at(-1)!;
    return { context, tips: [
      { cardIds: [last ? high.id : low.id], text: last
        ? `${cardsText([high])} är ett starkt kort att spela ut i sista sticket, men någon kan fortfarande slå det.`
        : `Spela ut ${cardsText([low])} och spara högre kort till senare stick.` },
      ...(last && high.id !== low.id ? [{ cardIds: [low.id], text: `${cardsText([low])} är ett försiktigare alternativ om du vill spara ett starkare kort.` }] : []),
    ] };
  }

  const winning = legal.filter((card) => card.suit === led &&
    trickWinner([...view.currentTrick, { playerId: viewerId, card }]) === viewerId);
  const cheapestWinner = winning[0];
  const tips: SupportTip[] = [];
  const lastToPlay = view.currentTrick.length === view.players.length - 1;
  const winningText = cheapestWinner && `${cardsText([cheapestWinner])} är ditt lägsta kort som slår de spelade korten${lastToPlay
    ? last ? ` och säkrar ${finalTrickPoints(view.settings)} poäng.` : "; då får du leda nästa stick."
    : "; spelare efter dig kan fortfarande slå det."}`;
  if (last && cheapestWinner)
    tips.push({ cardIds: [cheapestWinner.id], text: winningText! });
  if (!cheapestWinner || low.id !== cheapestWinner.id)
    tips.push({ cardIds: [low.id], text: `${cardsText([low])} är ditt lägsta spelbara kort. Du sparar starkare kort${low.suit !== led ? "; du har inget kort i färgen som spelades ut" : ""}.` });
  if (!last && cheapestWinner && lastToPlay)
    tips.push({ cardIds: [cheapestWinner.id], text: winningText! });
  if (!tips.length && cheapestWinner)
    tips.push({ cardIds: [cheapestWinner.id], text: winningText! });
  return { context, tips: tips.slice(0, 2) };
}
