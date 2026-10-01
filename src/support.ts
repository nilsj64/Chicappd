import { translate, localizeMessage } from "./locale.ts";
import type { Language, Translator } from "./locale.ts";
import type { Card, GameView } from "./game.ts";
import { finalTrickPoints, suitName } from "./game.ts";
import { chooseBotDiscards } from "./bot.ts";
import { evaluateHand } from "./poker.ts";
import { cardValue, legalCards, trickWinner } from "./tricks.ts";

export type SupportTip = { cardIds: string[]; text: string };
export type SupportAdvice = { context: string; tips: SupportTip[] };

function cardsText(cards: readonly Card[], language: Language): string {
  return cards.map((card) => translate(language, "{0} i {1}", [card.rank, localizeMessage(language, suitName[card.suit])])).join(", ");
}

/** Uses only the same projected information the player sees at the table. */
export function supportAdvice(view: GameView, viewerId: string, language: Language = "sv"): SupportAdvice {
  const t: Translator = (key, values) => translate(language, key, values);
  const player = view.players.find((candidate) => candidate.id === viewerId);
  if (!player || view.phase !== "table") return { context: "", tips: [] };

  if (view.tableStage === "exchange") {
    const hand = player.hand;
    if (hand.length !== 5) return { context: t("Vänta på att korten delas ut."), tips: [] };
    if (view.exchangeSubmittedPlayerIds.includes(viewerId)) return {
      context: t("Kortbyte {0} av 3. Du är klar; vänta på de andra spelarna.", [view.exchangeCount + 1]),
      tips: [],
    };
    const evaluation = evaluateHand(hand);
    const discards = new Set(chooseBotDiscards(hand));
    const keep = hand.filter((card) => !discards.has(card.id));
    const change = hand.filter((card) => discards.has(card.id));
    const context = t("Kortbyte {0} av 3. Bästa handen ger poäng efter första och andra bytet. Händerna vid rundans slut jämförs efter sticken. Välj kort att byta eller behåll handen.", [view.exchangeCount + 1]);
    if (!change.length) return { context, tips: [{ cardIds: keep.map((card) => card.id), text: t("{0}: behåll gärna alla fem kort. En färdig kombination är värd att skydda.", [localizeMessage(language, evaluation.label)]) }] };
    const made = evaluation.strength > 0;
    return { context, tips: [
      { cardIds: keep.map((card) => card.id), text: t("Behåll gärna {0}: {1}", [cardsText(keep, language), made ? t("{0} bygger på dessa kort.", [localizeMessage(language, evaluation.label)]) : t("det är dina högsta kort just nu.")]) },
      { cardIds: change.map((card) => card.id), text: t("Överväg att byta {0}: {1}", [cardsText(change, language), made ? t("de behövs inte för din nuvarande kombination.") : t("lägre kort ger utrymme att förbättra handen.")]) },
    ] };
  }

  if (view.tableStage === "result") return {
    context: t("Rundan är slut. Bästa handen efter första och andra bytet och vid rundans slut gav poäng. Sista sticket gav {0} poäng.", [finalTrickPoints(view.settings)]),
    tips: [],
  };

  const last = view.completedTricks.length === 4;
  const led = view.currentTrick[0]?.card.suit ?? null;
  const context = `${last ? t("Sista sticket ger {0} poäng. ", [finalTrickPoints(view.settings)]) : t("De första fyra sticken ger inga poäng. ")}${led ? t("Du måste följa {0} om du kan. Bara kort i den färgen kan vinna sticket.", [localizeMessage(language, suitName[led])]) : t("Den som spelar ut bestämmer färg. Högsta kortet i den färgen vinner.")}`;
  if (view.waitingForNextTrick || view.activePlayerId !== viewerId || !player.hand.length)
    return { context, tips: [{ cardIds: [], text: t("Vänta på din tur. Den som vinner sticket spelar ut i nästa.") }] };

  const legal = legalCards(player.hand, led).sort((a, b) => cardValue(a) - cardValue(b));
  const low = legal[0];
  if (!low) return { context, tips: [] };
  if (!led) {
    const high = legal.at(-1)!;
    return { context, tips: [
      { cardIds: [last ? high.id : low.id], text: last
        ? t("{0} är ett starkt kort att spela ut i sista sticket, men någon kan fortfarande slå det.", [cardsText([high], language)])
        : t("Spela ut {0} och spara högre kort till senare stick.", [cardsText([low], language)]) },
      ...(last && high.id !== low.id ? [{ cardIds: [low.id], text: t("{0} är ett försiktigare alternativ om du vill spara ett starkare kort.", [cardsText([low], language)]) }] : []),
    ] };
  }

  const winning = legal.filter((card) => card.suit === led &&
    trickWinner([...view.currentTrick, { playerId: viewerId, card }]) === viewerId);
  const cheapestWinner = winning[0];
  const tips: SupportTip[] = [];
  const lastToPlay = view.currentTrick.length === view.players.length - 1;
  const winningText = cheapestWinner && t("{0} är ditt lägsta kort som slår de spelade korten{1}", [cardsText([cheapestWinner], language), lastToPlay
    ? last ? t(" och säkrar {0} poäng.", [finalTrickPoints(view.settings)]) : t("; då får du leda nästa stick.")
    : t("; spelare efter dig kan fortfarande slå det.")]);
  if (last && cheapestWinner)
    tips.push({ cardIds: [cheapestWinner.id], text: winningText! });
  if (!cheapestWinner || low.id !== cheapestWinner.id)
    tips.push({ cardIds: [low.id], text: t("{0} är ditt lägsta spelbara kort. Du sparar starkare kort{1}.", [cardsText([low], language), low.suit !== led ? t("; du har inget kort i färgen som spelades ut") : ""]) });
  if (!last && cheapestWinner && lastToPlay)
    tips.push({ cardIds: [cheapestWinner.id], text: winningText! });
  if (!tips.length && cheapestWinner)
    tips.push({ cardIds: [cheapestWinner.id], text: winningText! });
  return { context, tips: tips.slice(0, 2) };
}
