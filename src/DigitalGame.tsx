import { useI18n } from "./LanguageProvider";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { evaluateHand, handCategoryName, pokerHandName } from "./poker";
import type { Card, ExchangeEvent, GameSettings, GameState, GameView, PlayerView } from "./game";
import {
  applyCommand,
  roomCapacity,
  CPU_REVEAL_MS,
  CPU_EXCHANGE_PAUSE_MS,
  needsTimedBotExchange,
  digitalMatchWinnerId,
  canPlayerDeclareChicago,
  createRoom,
  randomRoomCode,
  suitName,
  playedCardsForPlayer,
  viewForPlayer,
} from "./game";
import { legalCards } from "./tricks";
import type { PlayedCard } from "./tricks";
import { supportAdvice } from "./support";
import { API_URL, commandOnline, enterOnline, leaveOnline, loadOnline, savedSession, saveSession, watchOnline } from "./online";
import type { OnlineSession } from "./online";
import Brand, { BrandMark } from "./Brand";
import { Icon, SuitIcon } from "./Icon";
import { canExchangeCards, scoreStandings } from "./scoring";
import { MatchPodium } from "./MatchPodium";
import ChibiDealer from "./ChibiDealer";
import { DEALER_RELEASE_MS, EXCHANGE_STAGGER_MS, REPLACEMENT_FLIGHT_MS,
  REPLACEMENT_FLIP_MS, exchangeTimeline } from "./dealerAnimation";
import { exchangeDisplayState, exchangeHandSlots, replacementKey } from "./exchangePresentation";
import type { CardRect, ExchangePlayback, Replacement } from "./exchangePresentation";
import { useAccountHistory } from "./HistoryProvider";
import { accountName } from "./account";
import { digitalResult, digitalResultId } from "./digitalHistory";

type CardFlight = PlayedCard & { from: { x: number; y: number; width: number; height: number } };
const CARD_FLIGHT_MS = 360;
const BOT_PAUSE_MS = 290;
const TRICK_REVIEW_MS = 1300;
const rankName: Partial<Record<Card["rank"], string>> = {
  J: "knekt", Q: "dam", K: "kung", A: "ess",
};

function cardOrigin(selector: string): CardFlight["from"] | null {
  const rect = document.querySelector(selector)?.getBoundingClientRect();
  return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
}

type EntryMode = "create" | "join" | null;
type RoomEntry =
  | { kind: "create" }
  | { kind: "join"; code: string };

function FinalTrickRule({ points }: { points: 2 | 5 }) {
  const { t } = useI18n();
  return <span>{t("Sista sticket:")}{" "}{points} {" "}{t("p")}</span>;
}

function PlayingCard({
  card,
  selected = false,
  onClick,
  small = false,
  unavailable = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  card: Card;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
  unavailable?: boolean;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const { t, message } = useI18n();
  const red = card.suit === "hearts" || card.suit === "diamonds";
  return (
    <button
      type="button"
      data-card-id={card.id}
      className={`playing-card ${red ? "card-red" : "card-black"} ${selected ? "selected" : ""} ${small ? "card-small" : ""} ${unavailable ? "card-unavailable" : ""}`}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      aria-label={t("{0} i {1}{2}", [message(rankName[card.rank] ?? card.rank), message(suitName[card.suit]), selected ? t(", valt") : ""])}
      aria-pressed={selected}
      disabled={!onClick || unavailable}
    >
      <span className="card-corner">
        <b>{card.rank}</b>
        <SuitIcon suit={card.suit} />
      </span>
      <span className="card-center"><SuitIcon suit={card.suit} /></span>
      <span className="card-corner card-corner-bottom">
        <b>{card.rank}</b>
        <SuitIcon suit={card.suit} />
      </span>
    </button>
  );
}

const cardBackAsset = (appearance: "light" | "dark") =>
  `${import.meta.env.BASE_URL}Chicappd-brand-assets/Chicappd-card-backs/card-back-${appearance}.svg`;

function CardBack({ small = false, cardId }: { small?: boolean; cardId?: string }) {
  const { t } = useI18n();
  return (
    <div
      className={`card-back ${small ? "card-small" : ""}`}
      data-card-id={cardId}
      aria-label={t("Kort med baksidan uppåt")}
      style={{ backgroundImage: `url(${cardBackAsset("dark")})` }}
    />
  );
}

function Avatar({
  player,
  viewerId,
  size = "normal",
}: {
  player: PlayerView;
  viewerId: string;
  size?: "normal" | "small";
}) {
  const colors = ["peach", "lavender", "mint", "sand"];
  const index = player.id === viewerId
    ? 0
    : (Number(player.id.replace(/\D/g, "")) % 3) + 1;
  return (
    <span className={`avatar avatar-${colors[index]} avatar-${size}`}>
      {player.name.slice(0, 1).toUpperCase()}
    </span>
  );
}


function Entry({
  mode,
  onBack,
  onSubmit, error, busy,
}: {
  mode: Exclude<EntryMode, null>;
  onBack: () => void;
  onSubmit: (name: string, entry: RoomEntry) => void;
  error: string | null;
  busy: boolean;
}) {
  const { t, errorMessage } = useI18n();
  const { user, loading: accountLoading } = useAccountHistory();
  const username = user ? accountName(user) : null;
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const joining = mode === "join";
  return (
    <div className="entry-page">
      <header className="page-width inner-header">
        <Brand />
        <button className="text-button" onClick={onBack}>
          <Icon name="arrow-left" /> {" "}{t("Tillbaka")}</button>
      </header>
      <main className="entry-layout page-width">
        <div className="entry-intro">
          <div className="eyebrow">
            <span className="eyebrow-line" /> {" "}{t("DAGS ATT SPELA")}</div>
          <h1>
            {joining ? (
              <>
                {t("Hitta din plats")}<br />
                <em>{t("vid bordet.")}</em>
              </>
            ) : (
              <>
                {t("Bjud in till")}<br />
                <em>{t("kortkväll.")}</em>
              </>
            )}
          </h1>
          <p>
            {joining
              ? t("Skriv in koden du fick av den som skapade rummet.")
              : t("Skapa ett rum och bjud in vänner eller lägg till datorstyrda spelare.")}
          </p>
          <div className="entry-deco suit-row"><SuitIcon suit="clubs" /><SuitIcon suit="diamonds" />
            <SuitIcon suit="spades" /><SuitIcon suit="hearts" /></div>
        </div>
        <form
          className="entry-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (accountLoading) return;
            if (joining) {
              onSubmit(username ?? (name.trim() || t("Du")), {
                kind: "join",
                code: code.trim().toUpperCase(),
              });
            } else {
              onSubmit(username ?? (name.trim() || t("Du")), { kind: "create" });
            }
          }}
        >
          <div className="form-icon"><BrandMark /></div>
          <div className="form-kicker">
            {joining ? t("GÅ MED I RUM") : t("SKAPA RUM")}
          </div>
          <h2>{joining ? t("Gå med i ett rum") : t("Skapa ett rum")}</h2>
          {accountLoading ? <p role="status">{t("Ett ögonblick…")}</p> : username ? <p className="entry-identity">{t("Du spelar som {0}", [username])}</p> : <>
          <label htmlFor="player-name">{t("Vad heter du?")}</label>
          <input
            id="player-name"
            maxLength={20}
            placeholder={t("Ditt namn")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          </>}
          {joining && (
            <>
              <label htmlFor="room-code">{t("Rumskod")}</label>
              <input
                id="room-code"
                className="code-input"
                maxLength={5}
                minLength={5}
                placeholder={t("T.ex. Q7K2P")}
                value={code}
                onChange={(event) =>
                  setCode(
                    event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                  )
                }
                required
              />
            </>
          )}
          <button
            className="button button-primary form-submit"
            type="submit" disabled={busy || accountLoading}
          >
            {joining ? t("Gå med i rummet") : t("Skapa rummet")} <Icon name="arrow-up-right" />
          </button>
          {error && <p className="form-note" role="alert">{errorMessage(error)}</p>}
          <p className="form-note">{API_URL ? t("Spela tillsammans online") : t("Spela lokalt med datorstyrda spelare")}</p>
        </form>
      </main>
    </div>
  );
}

function Seat({ player, index, viewerId, onRemoveBot }: {
  player?: PlayerView; index: number; viewerId: string; onRemoveBot?: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className={`lobby-seat ${player ? "seat-filled" : ""}`}>
      <span className="seat-index">0{index + 1}</span>
      {player ? (
        <>
          <Avatar player={player} viewerId={viewerId} />
          <div className="seat-name">{player.name}</div>
          <div className="seat-detail">
            {player.id === viewerId ? t("Du") : player.control === "bot" ? t("Datorspelare") : t("Spelare")}
          </div>
          {player.control === "bot" && onRemoveBot && <button type="button" className="seat-remove"
            onClick={() => onRemoveBot(player.id)} aria-label={t("Ta bort {0}", [player.name])}>{t("Ta bort")}</button>}
        </>
      ) : (
        <>
          <span className="empty-avatar"><Icon name="plus" /></span>
          <div className="seat-name">{t("Ledig plats")}</div>
          <div className="seat-detail">{t("Ingen sitter här än")}</div>
        </>
      )}
    </div>
  );
}

function Lobby({
  game,
  viewerId,
  onAddBot,
  onRemoveBot,
  onSettings,
  onStart,
  onLeave, online,
}: {
  game: GameView;
  viewerId: string;
  online: boolean;
  onAddBot: () => void;
  onRemoveBot: (id: string) => void;
  onSettings: (settings: GameSettings) => void;
  onStart: () => void;
  onLeave: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const capacity = online ? roomCapacity(game) : 4;
  const matchWinner = digitalMatchWinnerId(game);
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(game.roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="lobby-page">
      <header className="page-width inner-header">
        <Brand />
        <button className="text-button" onClick={onLeave}>
          {t("Lämna rum")}{" "}<Icon name="arrow-up-right" />
        </button>
      </header>
      <main className="lobby-main page-width">
        <div className="lobby-heading">
          <div className="eyebrow">
            <span className="eyebrow-line" /> {" "}{t("SPELRUM")}</div>
          <h1>
            {t("Välkommen till")}{" "}<em>{t("bordet.")}</em>
          </h1>
          <p>{online ? t("Dela rumskoden med vänner eller lägg till datorstyrda spelare. Ägaren startar när minst två spelare är här.") : t("Lägg till datorstyrda spelare och starta när ni är minst två.")}</p>
        </div>
        <div className="lobby-content">
          {matchWinner && <MatchPodium players={game.players} winnerId={matchWinner} />}
          <section className="lobby-panel">
            <div className="panel-topline">
              <span>{t("SPELARE")}</span>
              <span>{game.players.length} {" "}{t("AV {0} PLATSER", [capacity])}</span>
            </div>
            <div className="seats-grid">
              {Array.from({ length: capacity }, (_, index) => (
                <Seat key={index} player={game.players[index]} index={index} viewerId={viewerId}
                  onRemoveBot={game.ownerId === viewerId ? onRemoveBot : undefined} />
              ))}
            </div>
            <div className="lobby-panel-bottom">
              <span>
                <span className="status-dot" /> {online ? t("Onlinerum") : t("Lokalt rum")}
              </span>
              <button
                className="small-button"
                onClick={onAddBot}
                disabled={game.players.length >= 4 || game.ownerId !== viewerId}
              >
                <Icon name="plus" /> {" "}{t("Lägg till datorspelare")}</button>
            </div>
          </section>
          <aside className="room-panel">
            <div className="room-panel-icon"><BrandMark /></div>
            <span className="form-kicker">{t("DITT RUM")}</span>
            <h2>
              {online ? t("Dela koden") : t("Ditt spel")}
              <br />
              {online ? t("med vännerna.") : t("börjar här.")}
            </h2>
            {online ? <><div className="room-code-label">{t("RUMSKOD")}</div>
              <button className="room-code" onClick={copyCode} title={t("Kopiera rumskod")}>
                <span>{game.roomCode}</span>
                <span className="copy-icon"><Icon name={copied ? "check" : "copy"} /></span>
              </button>
              <p>{copied ? t("Koden är kopierad!") : t("Tryck på koden för att kopiera den.")}</p></>
              : <p>{t("Lägg till datorstyrda spelare och välj regler innan ni börjar.")}</p>}
            <section className="room-rule" aria-labelledby="room-rule-title">
              <h3 id="room-rule-title" className="room-code-label">{t("POÄNGREGEL")}</h3>
              <label>{t("Sista sticket")}<select value={game.settings.finalTrickPoints} disabled={game.ownerId !== viewerId}
                  onChange={(event) => onSettings({ ...game.settings, finalTrickPoints: Number(event.target.value) as 2 | 5 })}>
                  <option value={5}>{t("5 poäng")}</option><option value={2}>{t("2 poäng")}</option>
                </select>
              </label>
              <label>{t("Chicago krävs för vinst")}<select value={(game.settings.chicagoRequiredToWin ?? true) ? "yes" : "no"} disabled={game.ownerId !== viewerId}
                  onChange={(event) => onSettings({ ...game.settings, chicagoRequiredToWin: event.target.value === "yes" })}>
                  <option value="yes">{t("På")}</option><option value="no">{t("Av")}</option>
                </select>
              </label>
              <label>{t("Minuspoäng")}<select value={game.settings.allowNegativeScores ? "yes" : "no"} disabled={game.ownerId !== viewerId}
                  onChange={(event) => onSettings({ ...game.settings, allowNegativeScores: event.target.value === "yes" })}>
                  <option value="no">{t("Tillåt inte minuspoäng")}</option><option value="yes">{t("Tillåt minuspoäng")}</option>
                </select>
              </label>
              <label>{t("Första som bryter Chicago får 10 poäng")}<select value={game.settings.firstChicagoBreakBonus ? "yes" : "no"} disabled={game.ownerId !== viewerId}
                  onChange={(event) => onSettings({ ...game.settings, firstChicagoBreakBonus: event.target.value === "yes" })}>
                  <option value="no">{t("Av")}</option><option value="yes">{t("På")}</option>
                </select>
              </label>
              <label>{t("Nollställ vid över 52 poäng utan Chicago")}<select value={game.settings.resetOver52WithoutChicago ? "yes" : "no"} disabled={game.ownerId !== viewerId}
                  onChange={(event) => onSettings({ ...game.settings, resetOver52WithoutChicago: event.target.value === "yes" })}>
                  <option value="no">{t("Av · behåll poängen")}</option><option value="yes">{t("På · nollställ till 0")}</option>
                </select>
              </label>
            </section>
            <div className="room-start">
              <button
                className="button button-primary start-button"
                aria-describedby="room-start-hint"
                onClick={onStart}
                disabled={game.players.length < 2 || game.players.length > capacity || game.ownerId !== viewerId || !!matchWinner}
              >
                {t("Börja spela")}{" "}<Icon name="arrow-right" />
              </button>
              <small id="room-start-hint">
                {matchWinner ? t("Matchen är avgjord. Skapa ett nytt rum för en ny match.")
                  : game.players.length < 2
                  ? t("Bjud in en vän eller lägg till en datorstyrd spelare.")
                  : t("Starta matchen med fem kort var.")}
              </small>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Opponent({
  player,
  viewerId,
  active,
  position,
  playedCards,
  showPlayedCards,
  currentCardIds,
  flight,
  onCardLanded,
}: {
  player: PlayerView;
  viewerId: string;
  active: boolean;
  position: "top" | "left" | "right";
  playedCards: Card[];
  showPlayedCards: boolean;
  currentCardIds: Set<string>;
  flight: CardFlight | null;
  onCardLanded: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={`opponent seat-${position} ${active ? "opponent-active" : ""}`} data-player-id={player.id}>
      <div className="opponent-cards">
        {Array.from({ length: player.handCount }, (_, index) => (
          <CardBack key={index} small />
        ))}
      </div>
      <div className="opponent-label">
        <Avatar player={player} viewerId={viewerId} size="small" />
        <span>
          <strong className="table-player-name">{player.name} <span className="table-player-score">{player.score} {" "}{t("p")}</span></strong>
          {active && <small>{t("Spelar nu")}</small>}
        </span>
      </div>
      {showPlayedCards && <PlayedStack cards={playedCards} player={player}
        currentCardIds={currentCardIds} flight={flight} onCardLanded={onCardLanded} />}
    </div>
  );
}

function pileOffset(index: number) {
  return {
    x: ((index * 7) % 13) - 6 + Math.floor(index / 4) * 2,
    y: ((index * 5) % 9) - 4 + Math.floor(index / 4) * 2,
    angle: ((index * 11) % 15) - 7,
  };
}

function DiscardPile({ count }: { count: number }) {
  const { t } = useI18n();
  return <div className="discard-pile" aria-label={t("Hög med {0} bortbytta kort", [count])}>
    <div className="physical-pile discard-pile-cards">
      {Array.from({ length: count }, (_, index) => {
        const offset = pileOffset(index);
        return <div className="physical-pile-card" key={index}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) rotate(${offset.angle}deg)`, zIndex: index + 1 }}>
          <CardBack small />
        </div>;
      })}
    </div>
  </div>;
}

function DeckPile({ count }: { count: number }) {
  const { t } = useI18n();
  return <div className="physical-pile deck-pile" aria-label={t("Kortlek med {0} kort kvar", [count])}>
    {Array.from({ length: count }, (_, index) => {
      const offset = pileOffset(index);
      return <div className="physical-pile-card" key={index}
        style={{ transform: `translate(${offset.x / 2}px, ${offset.y / 2}px) rotate(${offset.angle / 3}deg)`, zIndex: index + 1 }}>
        <CardBack small />
      </div>;
    })}
  </div>;
}

function replacementTarget(own: boolean, playerId: string, slot: number) {
  return own ? document.querySelector(`.your-hand [data-dealer-slot="${slot}"] .playing-card`)
    : document.querySelector(`[data-player-id="${CSS.escape(playerId)}"] .opponent-cards .card-back:nth-child(${slot + 1})`);
}

function ReplacementFlight({ replacement, event, own, onLanded }: {
  replacement: Replacement; event: ExchangeEvent; own: boolean;
  onLanded: (key: string) => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState("waiting");
  const landedRef = useRef(onLanded);
  landedRef.current = onLanded;
  const finishRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const node = nodeRef.current;
    const dealer = document.querySelector(".chibi-dealer");
    const target = replacementTarget(own, event.playerId, replacement.slot);
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      setPhase("done");
      landedRef.current(replacementKey(event.id, replacement.card?.id ?? String(replacement.slot)));
      if (!own && target instanceof HTMLElement) target.style.visibility = "";
    }
    finishRef.current = finish;
    if (!node || !dealer || !target) { finish(); return; }
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches) { finish(); return; }
    if (!own && target instanceof HTMLElement) target.style.visibility = "hidden";
    let animation: Animation | undefined;
    let arrived = false;
    // Measure at the current viewport size, including while resizing/scrolling.
    // Preserve animation progress when refreshing its responsive endpoints.
    function position() {
      if (done || !node || !dealer || !target) return;
      const to = target.getBoundingClientRect();
      const from = dealer.getBoundingClientRect();
      Object.assign(node.style, { left: `${to.x}px`, top: `${to.y}px`, width: `${to.width}px`, height: `${to.height}px` });
      if (arrived) return;
      const progress = animation?.currentTime;
      animation?.cancel();
      const x = from.x + from.width * .28 - to.x - to.width / 2;
      const y = from.y + from.height * .65 - to.y - to.height / 2;
      const start = `translate(${x}px, ${y}px) scale(.35) rotate(-8deg)`;
      animation = node.animate([
        { transform: start, opacity: 0, offset: 0 },
        { transform: start, opacity: 1, offset: .02 },
        { transform: "translate(0, 0) scale(1) rotate(0deg)", opacity: 1 },
      ], { duration: REPLACEMENT_FLIGHT_MS, easing: "cubic-bezier(.2,.7,.2,1)", fill: "both" });
      if (typeof progress === "number") animation.currentTime = progress;
      animation.onfinish = () => {
        arrived = true;
        if (own && replacement.card) setPhase("flipping");
        else finish();
      };
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(target);
    observer.observe(dealer);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const reduce = () => { if (motion.matches) { animation?.cancel(); finish(); } };
    motion.addEventListener("change", reduce);
    return () => {
      animation?.cancel();
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      motion.removeEventListener("change", reduce);
      if (!own && target instanceof HTMLElement) target.style.visibility = "";
    };
  }, [event.id, own, event.playerId, replacement]);
  return <div ref={nodeRef} className={`replacement-flight-card ${phase === "flipping" ? "replacement-card-flipping" : ""}`}
    data-replacement-card-id={replacement.card?.id} data-replacement-slot={replacement.slot}
    style={{ visibility: phase === "done" ? "hidden" : undefined,
      "--replacement-flip-ms": `${REPLACEMENT_FLIP_MS}ms` } as CSSProperties} aria-hidden="true">
    <div className="replacement-card-inner" onAnimationEnd={() => finishRef.current()}>
      <div className="replacement-card-face replacement-card-back"><CardBack small /></div>
      {replacement.card && <div className="replacement-card-face replacement-card-front"><PlayingCard card={replacement.card} /></div>}
    </div>
  </div>;
}

function ExchangeFlight({ playback, playerName, own, releaseCue, completedDealCue, onDeal, onLanded, onComplete }: {
  playback: ExchangePlayback; playerName: string; own: boolean; releaseCue?: string; completedDealCue?: string;
  onDeal: (cue: string) => void; onLanded: (key: string) => void; onComplete: () => void;
}) {
  const { t } = useI18n();
  const { event, sources, replacements, reducedMotion } = playback;
  const timeline = exchangeTimeline(event.changedCards, replacements.length);
  const [cards, setCards] = useState<CSSProperties[]>([]);
  const [replacementIndex, setReplacementIndex] = useState(0);
  const [delivering, setDelivering] = useState<number | null>(null);
  const [settledReplacement, setSettledReplacement] = useState(false);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  function finishReplacement(key: string) {
    onLanded(key);
    setDelivering(null);
    setSettledReplacement(true);
  }
  useLayoutEffect(() => {
    if (!settledReplacement || completedDealCue !== `exchange:${event.id}:${replacementIndex}`) return;
    setSettledReplacement(false);
    if (replacementIndex + 1 < replacements.length) setReplacementIndex(replacementIndex + 1);
    else completeRef.current();
  }, [settledReplacement, completedDealCue, event.id, replacementIndex, replacements.length]);
  useLayoutEffect(() => {
    if (releaseCue === `exchange:${event.id}:${replacementIndex}`) setDelivering(replacementIndex);
  }, [releaseCue, event.id, replacementIndex]);
  useEffect(() => {
    if (!replacementIndex) return;
    const timer = window.setTimeout(() => onDeal(`exchange:${event.id}:${replacementIndex}`), EXCHANGE_STAGGER_MS);
    return () => window.clearTimeout(timer);
  }, [replacementIndex, event.id, onDeal]);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduce = () => { if (motion.matches) completeRef.current(); };
    motion.addEventListener("change", reduce);
    return () => motion.removeEventListener("change", reduce);
  }, []);
  useLayoutEffect(() => {
    if (reducedMotion) return;
    const target = document.querySelector(".discard-pile");
    if (!target) return;
    const to = target.getBoundingClientRect();
    setCards(sources.map((from, index) => ({
      left: from.x, top: from.y, width: from.width, height: from.height,
      "--exchange-x": `${to.x + to.width / 2 - from.x - from.width / 2}px`,
      "--exchange-y": `${to.y + to.height / 2 - from.y - from.height / 2}px`,
      animationDelay: `${DEALER_RELEASE_MS + index * EXCHANGE_STAGGER_MS}ms`,
    } as CSSProperties)));
    if (!replacements.length) return;
    const timer = window.setTimeout(() => onDeal(`exchange:${event.id}:0`), timeline.replacements[0].deal);
    return () => window.clearTimeout(timer);
  }, [playback, onDeal]);
  return <div className="exchange-playback" aria-live="polite" data-exchange-id={event.id}>
    {cards.map((style, index) => <div className="exchange-flight-card" style={style} key={index} aria-hidden="true">
      <CardBack small />
    </div>)}
    {!reducedMotion && delivering !== null && <ReplacementFlight key={delivering}
      replacement={replacements[delivering]} event={event} own={own} onLanded={finishReplacement} />}
    <div className="exchange-playback-label">{playerName} {event.singleCardChoice
      ? event.singleCardChoice === "accepted" ? t("tog det presenterade kortet") : t("avstod från kortet och fick ett nytt")
      : event.changedCards ? t("byter {0} kort", [event.changedCards]) : t("behåller handen")}</div>
  </div>;
}

function playedOffset(index: number, cardId: string) {
  const variation = cardLanding(cardId);
  return {
    x: -30 + index * 15 + variation.x / 3,
    y: -10 + index * 5 + variation.y / 3,
    angle: [-4, 1, -2, 3, 0][index] + variation.rotation / 2,
  };
}

function PlayedStack({ cards, player, currentCardIds, flight, onCardLanded }: {
  cards: Card[];
  player: PlayerView;
  currentCardIds: Set<string>;
  flight: CardFlight | null;
  onCardLanded: () => void;
}) {
  const { t } = useI18n();
  return <div className="played-stack" data-played-player-id={player.id}
    aria-label={t("{0}: {1} spelade kort", [player.name, cards.length])}>
    {cards.map((card, index) => <TrickCard key={card.id} played={{ playerId: player.id, card }}
      index={index} current={currentCardIds.has(card.id)} flight={flight} onLanded={onCardLanded} />)}
  </div>;
}

function TrickCard({ played, index, current, flight, onLanded }: {
  played: PlayedCard;
  index: number;
  current: boolean;
  flight: CardFlight | null;
  onLanded: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const variation = playedOffset(index, played.card.id);
  const landingTransform = `translate(${variation.x}px, ${variation.y}px) rotate(${variation.angle}deg)`;
  const flying = flight?.playerId === played.playerId && flight.card.id === played.card.id;
  const onLandedRef = useRef(onLanded);
  onLandedRef.current = onLanded;
  useLayoutEffect(() => {
    if (!flying || !flight || !cardRef.current) return;
    const node = cardRef.current;
    const target = node.getBoundingClientRect();
    const fromX = flight.from.x + flight.from.width / 2 - target.x - target.width / 2;
    const fromY = flight.from.y + flight.from.height / 2 - target.y - target.height / 2;
    const scaleX = flight.from.width / target.width;
    const scaleY = flight.from.height / target.height;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : CARD_FLIGHT_MS;
    const animation = node.animate([
      { transform: `translate(${fromX}px, ${fromY}px) scale(${scaleX}, ${scaleY})`, opacity: 1 },
      { transform: landingTransform, opacity: 1 },
    ], { duration, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)", fill: "both" });
    animation.onfinish = () => onLandedRef.current();
    return () => animation.cancel();
  }, [flying, flight]);
  return <div ref={cardRef} className={`trick-card ${flying ? "trick-card-flying" : ""} ${current ? "trick-card-current" : ""}`}
    data-played-card-id={played.card.id}
    style={{ transform: landingTransform, zIndex: index + 1 } as CSSProperties}>
    <PlayingCard card={played.card} small />
  </div>;
}

function cardLanding(cardId: string) {
  let hash = 0;
  for (const character of cardId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return {
    x: (hash % 9) - 4,
    y: (Math.floor(hash / 9) % 7) - 3,
    rotation: (Math.floor(hash / 63) % 9 - 4) * 0.5,
  };
}

function ScorePanel({ players, viewerId, settings }: { players: PlayerView[]; viewerId: string; settings: GameSettings }) {
  const { t } = useI18n();
  return (
    <aside className="score-panel">
      <div className="score-header">
        <span>{t("POÄNGSTÄLLNING")}</span>
        <span><BrandMark /></span>
      </div>
      <div className="score-list">
        {scoreStandings(players).map((player, index) => (
          <div className="score-row" key={player.id}>
            <span className="score-place">0{index + 1}</span>
            <Avatar player={player} viewerId={viewerId} size="small" />
            <span className="score-name">
              {player.name}
              {player.id === viewerId && <small>{t("DU")}</small>}
            </span>
            {(settings.chicagoRequiredToWin ?? true) && <span className={`chicago-check ${player.hasDeclaredChicago ? "checked" : ""}`}
              role="img" aria-label={player.hasDeclaredChicago ? t("{0} har sagt Chicago", [player.name]) : t("{0} har inte sagt Chicago", [player.name])}
              title={player.hasDeclaredChicago ? t("Har sagt Chicago") : t("Har inte sagt Chicago")}>
              {player.hasDeclaredChicago ? "✓" : ""}
            </span>}
            <strong>{player.score}</strong>
          </div>
        ))}
      </div>
      <div className="score-foot">
        {(settings.chicagoRequiredToWin ?? true) && <>{t("✓ = har sagt Chicago ·")}{" "}{t("Du måste ha sagt Chicago minst en gång för att vinna.")}{" "}</>}{t("Över 52 poäng krävs för vinst (minst 53).")} {t("Royal Flush ger omedelbar vinst oavsett poäng.")} {" "}{t("Från 46 poäng är kortbyte spärrat. Sista sticket ger också poäng.")}{settings.resetOver52WithoutChicago && t(" Över 52 utan Chicago nollställer poängen.")}
      </div>
    </aside>
  );
}

function ActivityLog({ activity, quiet }: { activity: string[]; quiet: boolean }) {
  const { t, message } = useI18n();
  const listRef = useRef<HTMLUListElement>(null);
  const previous = useRef({ count: 0, height: 0 });
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (activity.length > previous.current.count && list.scrollTop > 4)
      list.scrollTop += list.scrollHeight - previous.current.height;
    previous.current = { count: activity.length, height: list.scrollHeight };
  }, [activity]);
  return <div className={`table-activity ${quiet ? "table-activity-quiet" : ""}`} aria-live="polite">
    <span>{t("SENASTE HÄNDELSER")}</span>
    {activity.length === 0 ? <p>{t("Välj kort att byta eller behåll handen.")}</p> :
      <ul ref={listRef}>
        {activity.map((event, index) => <li key={`${index}-${event}`}>{message(event)}</li>).reverse()}
      </ul>}
  </div>;
}

function Table({
  game,
  viewerId,
  selectedCardIds,
  onToggle,
  onExchange,
  onKeep,
  onExchangeChoice,
  exchangeBusy,
  actionBusy,
  visibleDiscard,
  onPlayTrickCard,
  onDeclareChicago,
  flight,
  reviewedTrickCount,
  onCardLanded,
  onNextRound,
  onLobby,
  onLeave, online, onExchangePlaybackBusy,
}: {
  game: GameView;
  viewerId: string;
  online: boolean;
  selectedCardIds: string[];
  onToggle: (id: string) => void;
  onExchange: () => void;
  onKeep: () => void;
  onExchangeChoice: (accept: boolean) => void;
  exchangeBusy: boolean;
  actionBusy: boolean;
  visibleDiscard: number;
  onPlayTrickCard: (id: string, from?: CardFlight["from"]) => void;
  onDeclareChicago: () => void;
  flight: CardFlight | null;
  reviewedTrickCount: number;
  onCardLanded: () => void;
  onNextRound: () => void;
  onLobby: () => void;
  onLeave: () => void;
  onExchangePlaybackBusy?: (busy: boolean) => void;
}) {
  const { t, message, errorMessage, language } = useI18n();
  const local = game.players.find((player) => player.id === viewerId)!;
  const exchangeAllowed = canExchangeCards(local.score);
  const matchWinner = game.tableStage === "result" ? digitalMatchWinnerId(game) : null;
  const [supportOpen, setSupportOpen] = useState(false);
  const advice = supportOpen ? supportAdvice(game, viewerId, language) : null;
  const opponents = game.players.filter((player) => player.id !== viewerId);
  // Presentation snapshots preserve actual cards and the positions they left.
  // Fresh events are captured before painting the authoritative replacement hand.
  const seenExchangeEvent = useRef(game.exchangeEvents.at(-1)?.id ?? 0);
  const handSnapshot = useRef(local.hand);
  const geometry = useRef(new Map<string, CardRect>());
  const [presentedHand, setPresentedHand] = useState(local.hand);
  const [exchangeQueue, setExchangeQueue] = useState<ExchangePlayback[]>([]);
  const [landedReplacements, setLandedReplacements] = useState(new Set<string>());
  const [dealCue, setDealCue] = useState<string>();
  const [releaseCue, setReleaseCue] = useState<string>();
  const [completedDealCue, setCompletedDealCue] = useState<string>();
  const display = exchangeDisplayState(game, exchangeQueue, seenExchangeEvent.current);
  const exchanging = display.exchanging;
  const yourExchangeTurn = exchanging && !display.busy && display.activePlayerId === local.id;
  const pendingExchange = display.pendingExchange;
  const yourChoice = pendingExchange?.playerId === viewerId;
  const playingTricks = !display.busy && game.tableStage === "tricks";
  const reviewingTrick = playingTricks && game.waitingForNextTrick;
  const [initialDeal] = useState(game.exchangeCount === 0 && !game.currentTrick.length &&
    !game.completedTricks.length && game.tableStage !== "result");
  const initialCardIds = useRef(new Set(local.hand.map(card => card.id)));
  useLayoutEffect(() => {
    const fresh = game.exchangeEvents.filter(event => event.id > seenExchangeEvent.current);
    const slots = exchangeHandSlots(handSnapshot.current, local.hand);
    const latestOwn = fresh.filter(event => event.playerId === viewerId).at(-1);
    handSnapshot.current = slots.hand;
    setPresentedHand(slots.hand);
    if (!fresh.length) return;
    seenExchangeEvent.current = fresh.at(-1)!.id;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const playback = fresh.map(event => {
      const own = event.playerId === viewerId;
      const sources = own && event === latestOwn
        ? slots.discarded.map(card => geometry.current.get(card.id)).filter((rect): rect is CardRect => !!rect)
        : own ? [] : Array.from({ length: event.changedCards }, (_, slot) =>
          geometry.current.get(`${event.playerId}:${slot}`)).filter((rect): rect is CardRect => !!rect);
      const replacements = own ? event === latestOwn ? slots.replacements : []
        : Array.from({ length: Math.min(event.changedCards,
          game.players.find(player => player.id === event.playerId)?.handCount ?? 0) }, (_, slot) => ({ slot }));
      return { event, sources, replacements, reducedMotion };
    });
    setExchangeQueue(queue => [...queue, ...playback]);
  }, [game.exchangeEvents, local.hand, viewerId]);
  useLayoutEffect(() => {
    const positions = new Map<string, CardRect>();
    function remember(key: string, node: Element) {
      const { x, y, width, height } = node.getBoundingClientRect();
      positions.set(key, { x, y, width, height });
    }
    document.querySelectorAll<HTMLElement>(".your-hand [data-card-id]").forEach(node => remember(node.dataset.cardId!, node));
    document.querySelectorAll<HTMLElement>(".opponent[data-player-id]").forEach(player => {
      player.querySelectorAll(".opponent-cards .card-back").forEach((node, slot) => remember(`${player.dataset.playerId}:${slot}`, node));
    });
    geometry.current = positions;
  });
  const exchangePlayback = exchangeQueue[0];
  // Finish any last delivery before hiding the dealer for trick play.
  const showDealer = exchanging;
  useEffect(() => {
    // Animated exchanges finish after both the final landing/flip and dealer recovery.
    // Keeps and reduced-motion updates have no moving cards to wait for.
    if (!exchangePlayback || (!exchangePlayback.reducedMotion && exchangePlayback.replacements.length)) return;
    const timer = window.setTimeout(() => setExchangeQueue(queue => queue.slice(1)),
      exchangePlayback.reducedMotion ? 1 : exchangeTimeline(exchangePlayback.event.changedCards, 0).duration);
    return () => window.clearTimeout(timer);
  }, [exchangePlayback]);
  useLayoutEffect(() => {
    onExchangePlaybackBusy?.(display.busy);
  }, [display.busy, onExchangePlaybackBusy]);
  useEffect(() => () => onExchangePlaybackBusy?.(false), [onExchangePlaybackBusy]);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduce = () => {
      if (motion.matches) setExchangeQueue(queue => queue.map(item => ({ ...item, reducedMotion: true })));
    };
    motion.addEventListener("change", reduce);
    return () => motion.removeEventListener("change", reduce);
  }, []);
  const hiddenReplacementIds = new Set(exchangeQueue.flatMap(playback => playback.reducedMotion ? [] :
    playback.replacements.filter(replacement => replacement.card &&
      !landedReplacements.has(replacementKey(playback.event.id, replacement.card.id)))
      .map(replacement => replacement.card!.id)));
  const humanTurn = playingTricks && game.activePlayerId === local.id && !reviewingTrick && !flight && !exchangeQueue.length;
  const lastTrick = game.completedTricks.at(-1);
  const nextLeader = game.players.find((player) => player.id === display.activePlayerId);
  const firstTrickCard = game.currentTrick[0];
  const leadPlayer = game.players.find((player) => player.id === (firstTrickCard?.playerId ?? game.activePlayerId));
  const firstCardFlying = !!firstTrickCard && flight?.card.id === firstTrickCard.card.id;
  const pendingTrick = game.completedTricks.length > reviewedTrickCount;
  const showResult = game.tableStage === "result" && !pendingTrick && !flight && !exchangeQueue.length;
  const currentCardIds = new Set((game.currentTrick.length
    ? game.currentTrick : pendingTrick ? lastTrick?.cards ?? [] : []).map((played) => played.card.id));
  const selectionCount = exchangeAllowed ? selectedCardIds.length : 0;
  // The authoritative hand already contains replacements while they are in
  // flight. Reveal its combination only after every new card has flipped.
  const currentEvaluation = exchanging && !hiddenReplacementIds.size ? evaluateHand(local.hand) : null;
  const finalAward = game.handAwards.find((award) => award.exchangeCount === 3);
  const finalWinnerCategory = finalAward?.winnerId
    ? finalAward.evaluations[finalAward.winnerId]?.category : undefined;
  const finalTrickWinner = game.players.find((player) => player.id === game.finalTrickAward?.winnerId);
  const chicagoPlayer = game.players.find((player) => player.id === game.chicagoPlayerId);
  const chicagoBreaker = game.players.find((player) => player.id === game.chicagoBreakerId);
  const canDeclareChicago = canPlayerDeclareChicago(game, viewerId);
  const [showExchangeFeedback, setShowExchangeFeedback] = useState(false);
  const dragRef = useRef<{ id: string; pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.moved) return;
    suppressClickRef.current = drag.id;
    window.setTimeout(() => { if (suppressClickRef.current === drag.id) suppressClickRef.current = null; }, 0);
    const card = event.currentTarget;
    const drop = document.querySelector(".table-center-tricks")?.getBoundingClientRect();
    const withinDrop = !cancelled && !!drop &&
      event.clientX >= drop.left - 110 && event.clientX <= drop.right + 110 &&
      event.clientY >= drop.top - 90 && event.clientY <= drop.bottom + 90;
    if (withinDrop) {
      const rect = card.getBoundingClientRect();
      card.style.transform = "";
      card.style.zIndex = "";
      onPlayTrickCard(drag.id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    } else {
      const offsetX = event.clientX - drag.x;
      const offsetY = event.clientY - drag.y;
      const animation = card.animate([
        { transform: `translate(${offsetX}px, ${offsetY}px) rotate(-3deg)` },
        { transform: "translate(0, 0) rotate(0deg)" },
      ], { duration: 230, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
      card.style.transform = "";
      card.style.zIndex = "";
      animation.onfinish = () => animation.cancel();
    }
  }
  useEffect(() => {
    if (!game.exchangeFeedback) return;
    setShowExchangeFeedback(true);
    const timer = window.setTimeout(() => setShowExchangeFeedback(false), 2200);
    return () => window.clearTimeout(timer);
  }, [game.exchangeFeedback?.exchangeCount]);
  const handAction = <button
    className="hand-action"
    onClick={selectionCount ? onExchange : onKeep}
    disabled={exchangeBusy || !!exchangePlayback || !yourExchangeTurn || !!pendingExchange}
  >
    {selectionCount ? t("Byt {0} kort", [selectionCount])
      : t("Behåll handen")}
    <Icon name="arrow-right" />
  </button>;
  const legalTrickIds = new Set(playingTricks
    ? legalCards(local.hand, game.currentTrick[0]?.card.suit ?? null).map((card) => card.id)
    : []);
  return (
    <div className={`table-page ${initialDeal ? "dealer-initial-deal" : ""}`}
      style={{ "--dealer-release-delay": `${DEALER_RELEASE_MS}ms` } as CSSProperties}>
      <header className="table-header">
        <Brand light />
        <div className="table-header-center">
          <span className="table-room">{t("RUM")}{" "}{game.roomCode}</span>
          <span className="table-header-divider" />
          <span>
            <span className="live-dot" /> {online ? t("Onlinespel") : t("Lokalt spel")}
          </span>
        </div>
        <button className="table-exit" onClick={onLeave}>
          {t("Lämna spelet")}{" "}<Icon name="arrow-up-right" />
        </button>
      </header>
      <main className="table-layout">
        <section className="felt-wrap">
          <div className={`felt ${showDealer ? "felt-dealer" : ""} ${game.players.length > 4 ? "felt-many" : ""} ${exchanging ? "" : "felt-tricks"} ${showResult ? "felt-result" : ""}`}>
            <div className="felt-line" />
            {showDealer && <div className="dealer-zone">
              <ChibiDealer dealCue={dealCue} onRelease={setReleaseCue} onDealComplete={setCompletedDealCue}
                initialDeal={initialDeal}
                presentedExchange={pendingExchange ? `${pendingExchange.playerId}:${display.exchangeCount + 1}` : undefined} />
            </div>}
            {exchanging && <div className="exchange-round">{t("Kortbyte")}{" "}{display.exchangeCount + 1} {" "}{t("av 3")}</div>}
            {showExchangeFeedback && game.exchangeFeedback && <div className="exchange-toast" role="status">
              {t("Kortbyte")}{" "}{game.exchangeFeedback.exchangeCount} {" "}{t("klart ·")}{" "}{game.exchangeFeedback.changedCards === 0
                ? t("du behöll handen")
                : t("du bytte {0} kort", [game.exchangeFeedback.changedCards])}
            </div>}
            {exchangePlayback && <ExchangeFlight key={exchangePlayback.event.id} playback={exchangePlayback}
              playerName={game.players.find((player) => player.id === exchangePlayback.event.playerId)?.name ?? t("Spelare")}
              own={exchangePlayback.event.playerId === viewerId} releaseCue={releaseCue} completedDealCue={completedDealCue} onDeal={setDealCue}
              onLanded={key => setLandedReplacements(current => new Set([...current, key]))}
              onComplete={() => setExchangeQueue(queue => queue[0]?.event.id === exchangePlayback.event.id ? queue.slice(1) : queue)} />}
            <div className="opponents">
              {opponents.map((player, index) => (
                <Opponent
                  key={player.id}
                  player={player}
                  viewerId={viewerId}
                  active={display.activePlayerId === player.id}
                  position={opponents.length === 1 ? "top" : opponents.length === 2
                    ? index === 0 ? "left" : "right"
                    : ["left", "top", "right"][index % 3] as "left" | "top" | "right"}
                  playedCards={playedCardsForPlayer(game, player.id)}
                  showPlayedCards={!exchanging && !showResult}
                  currentCardIds={currentCardIds}
                  flight={flight}
                  onCardLanded={onCardLanded}
                />
              ))}
            </div>
            <div className={`table-center ${exchanging ? "" : "table-center-tricks"}`}>
              {exchanging ? <><div className="table-stacks">
                <div className="stack-group">
                  <DeckPile count={game.deckCount} />
                </div>
                <div className="stack-group">
                  <DiscardPile count={visibleDiscard} />
                </div>
              </div>
              {pendingExchange && <div key={`${pendingExchange.playerId}:${game.exchangeCount}:${pendingExchange.card.id}`}
                className="exchange-offer" aria-live="polite">
                <strong>{game.players.find((player) => player.id === pendingExchange.playerId)?.name} {" "}{t("byter ett kort")}</strong>
                <span>{t("Första nya kortet")}</span>
                <PlayingCard card={pendingExchange.card} />
                {yourChoice ? <div className="exchange-offer-actions">
                  <span>{t("Ta det visade kortet eller avstå och få nästa kort dolt.")}</span>
                  <button type="button" disabled={exchangeBusy || !!exchangePlayback} onClick={() => onExchangeChoice(true)}>{t("Ta det visade kortet")}</button>
                  <button type="button" disabled={exchangeBusy || !!exchangePlayback} onClick={() => onExchangeChoice(false)}>{t("Avstå · få ett nytt kort")}</button>
                </div> : <span>{t("Väntar på svar…")}</span>}
              </div>}
              </> : <div className="trick-view" aria-live="polite">
                {!showResult && <div className="trick-discard"><DiscardPile count={game.discardCount} /></div>}
                {chicagoPlayer && <div className="chicago-status" role="status">
                  {t("Chicago:")}{" "}<strong>{chicagoPlayer.name}</strong> {" "}{t("satsar på alla stick")}{!game.currentTrick.length && !game.completedTricks.length && <small>{t("Ordinarie första utspelaren har företräde, därefter gäller spelordningen. Chicago-spelaren börjar; valet låses vid första kortet.")}</small>}
                  {chicagoBreaker && <small>{message(game.activity.find(event => event === `${chicagoBreaker.name} bröt Chicago (+10 p)`) ?? `${chicagoBreaker.name} bröt Chicago`)}</small>}
                </div>}
                {playingTricks && !reviewingTrick && (!firstTrickCard || firstCardFlying) && leadPlayer &&
                  <div className="trick-cue">{leadPlayer.name} {" "}{t("spelar ut")}</div>}
                {playingTricks && !reviewingTrick && firstTrickCard && !firstCardFlying &&
                  <div className="trick-cue trick-suit-cue">{t("Följ färgen om du kan:")}{" "}<strong>{message(suitName[firstTrickCard.card.suit])}</strong></div>}
                {(game.tableStage === "result" || reviewingTrick) && <h2>{playingTricks
                  ? reviewingTrick
                    ? flight ? t("Kortet spelas…") : t("{0} vann stick {1}", [nextLeader?.name, game.completedTricks.length])
                    : ""
                  : pendingTrick ? t("{0} vann sista sticket", [finalTrickWinner?.name]) : t("Rundan är slut")}</h2>}
                {showResult && <div className="round-summary">
                  {matchWinner && <MatchPodium players={game.players} winnerId={matchWinner} />}
                  <div className="round-awards">
                    {game.finalTrickAward && <div><span>{t("Sista sticket · separat regel")}</span><strong>{finalTrickWinner?.name} <b>+{game.finalTrickAward?.points ?? 0} {" "}{t("p")}</b></strong></div>}
                    <div><span>{t("Bästa handen")}</span><strong>{finalAward?.winnerId
                      ? `${game.players.find((player) => player.id === finalAward.winnerId)?.name} · ${finalWinnerCategory ? message(game.royalFlushWinnerId ? "Royal Flush" : handCategoryName[finalWinnerCategory]) : ""}` : t("Ingen")}
                      <b>+{finalAward?.points ?? 0} {" "}{t("p")}</b></strong></div>
                    {game.chicagoAward && <div><span>Chicago</span><strong>{chicagoPlayer?.name}
                      <b>{game.chicagoAward.points > 0 ? "+" : ""}{game.chicagoAward.points} {" "}{t("p")}</b></strong></div>}
                  </div>
                  <div className="round-hands"><h3>{t("Händer vid rundans slut")}</h3><ul>{game.players.map((player) => <li key={player.id}>
                    <span>{player.name}</span><span>{finalAward?.evaluations[player.id]
                      ? message(pokerHandName(finalAward.evaluations[player.id])) : ""}</span>
                  </li>)}</ul></div>
                  {!matchWinner && <button className="button button-next-round" onClick={onNextRound}>
                    {t("Spela en runda till")}{" "}<Icon name="arrow-right" />
                  </button>}
                </div>}
              </div>}
            </div>
            <div className="your-area">
              {exchanging && <div className="hand-combination" aria-live="polite">{currentEvaluation ? message(currentEvaluation.label) : ""}</div>}
              <div className="your-label">
                <Avatar player={local} viewerId={viewerId} size="small" />
                <span>
                  <strong>
                    {local.name} <em>{t("DU")}</em> <span className="table-player-score">{local.score} {" "}{t("p")}</span>
                  </strong>
                  {game.tableStage !== "result" && <small>
                    {exchanging ? yourChoice ? t("Välj Ja eller Nej för det öppna kortet")
                      : yourExchangeTurn && !pendingExchange ? exchangeAllowed ? t("Välj kort att byta eller behåll handen") : t("Från 46 poäng får du inte byta kort")
                      : !exchangeAllowed ? t("Du får inte byta kort. Väntar på {0}…", [nextLeader?.name ?? t("Nästa spelare")])
                      : t("{0} byter först…", [nextLeader?.name ?? t("Nästa spelare")])
                      : reviewingTrick ? t("Nästa stick börjar snart")
                      : playingTricks && !humanTurn ? t("{0} spelar…", [nextLeader?.name ?? t("Nästa spelare")])
                      : t("Tryck på ett kort eller dra det till bordet")}
                  </small>}
                </span>
              </div>
              {!exchanging && !showResult && <PlayedStack cards={playedCardsForPlayer(game, local.id)} player={local}
                currentCardIds={currentCardIds} flight={flight} onCardLanded={onCardLanded} />}
              <div className="your-hand">
                {presentedHand.map((card, slot) => (
                  <div key={card.id} data-dealer-slot={slot}
                    className={initialDeal && initialCardIds.current.has(card.id) ? "dealer-card-reveal" : undefined}
                    style={{ visibility: hiddenReplacementIds.has(card.id) ? "hidden" : undefined }}>
                  <PlayingCard
                    card={card}
                    selected={exchanging && selectedCardIds.includes(card.id)}
                    unavailable={(exchanging && (!yourExchangeTurn || !!pendingExchange || !exchangeAllowed)) ||
                      (playingTricks && (!humanTurn || !legalTrickIds.has(card.id)))}
                    onClick={
                      game.tableStage === "result" || exchangeBusy || !!exchangePlayback ||
                      (exchanging && (!yourExchangeTurn || !!pendingExchange || !exchangeAllowed)) || (playingTricks && !humanTurn) ? undefined
                        : playingTricks ? () => {
                          if (suppressClickRef.current === card.id) { suppressClickRef.current = null; return; }
                          onPlayTrickCard(card.id);
                        }
                        : () => onToggle(card.id)
                    }
                    onPointerDown={playingTricks && humanTurn && legalTrickIds.has(card.id) ? (event) => {
                      if (event.pointerType === "mouse" && event.button !== 0) return;
                      suppressClickRef.current = null;
                      dragRef.current = { id: card.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    } : undefined}
                    onPointerMove={playingTricks ? (event) => {
                      const drag = dragRef.current;
                      if (!drag || drag.id !== card.id || drag.pointerId !== event.pointerId) return;
                      const dx = event.clientX - drag.x;
                      const dy = event.clientY - drag.y;
                      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
                      drag.moved = true;
                      event.currentTarget.style.transform = `translate(${dx}px, ${dy}px) rotate(-3deg)`;
                      event.currentTarget.style.zIndex = "10";
                    } : undefined}
                    onPointerUp={playingTricks ? (event) => finishDrag(event) : undefined}
                    onPointerCancel={playingTricks ? (event) => finishDrag(event, true) : undefined}
                  />
                  </div>
                ))}
              </div>
              {exchanging && exchangeAllowed && handAction}
              {playingTricks && !game.currentTrick.length && !game.completedTricks.length &&
                <button type="button" className="button chicago-button" onClick={onDeclareChicago}
                  disabled={!canDeclareChicago || actionBusy || !!flight || !!exchangeQueue.length}>
                  {t("Säg Chicago · alla fem stick (+15 / −15)")}</button>}
              {playingTricks && !game.chicagoPlayerId && local.score < 15 && !game.completedTricks.length &&
                <div className="chicago-hint">{t("Chicago kräver minst 15 poäng.")}</div>}
              {game.trickError && <div className="selection-count selection-error" role="status">{errorMessage(game.trickError)}</div>}
            </div>
          </div>
        </section>
        <aside className="table-sidebar">
          <div className="sidebar-top">
            <span className="sidebar-eyebrow">{t("SPELBORD")}</span>
            <h1>
              Chicappd<span>.</span>
            </h1>
            <p>{t("Fem kort på hand. Vem vinner rundan?")}</p>
          </div>
          <button type="button" className="support-toggle" aria-expanded={supportOpen}
            aria-controls="support-sheet" onClick={() => setSupportOpen((open) => !open)}>
            <span>{t("Tips och regler")}</span><span>{supportOpen ? t("Dölj") : t("Visa")} <Icon name={supportOpen ? "minus" : "plus"} /></span>
          </button>
          {supportOpen && advice && <section id="support-sheet" className="support-sheet" aria-label={t("Tips och regler")} aria-live="polite">
            <p>{advice.context}</p>
            {advice.tips.map((tip, index) => <div className="support-tip" key={index}>
              <span>{game.tableStage === "exchange" ? (index === 0 ? t("BEHÅLL GÄRNA") : t("ÖVERVÄG ATT BYTA")) : (index === 0 ? t("FÖRSLAG") : t("ALTERNATIV"))}</span>
              <p>{tip.text}</p>
            </div>)}
          </section>}
          <ScorePanel players={game.players} viewerId={viewerId} settings={game.settings} />
          {!exchanging && <div className="trick-tally">
            <span>{t("VUNNA STICK")}</span>
            {game.players.map((player) => <div key={player.id}>
              <span>{player.name}</span>
              <strong>{game.completedTricks.filter((trick) => trick.winnerId === player.id).length}</strong>
            </div>)}
          </div>}
          <div className="table-rule">
            <FinalTrickRule points={game.settings.finalTrickPoints} />
          </div>
          {(!exchanging || game.activity.length > 0) &&
            <ActivityLog activity={game.activity} quiet={exchanging} />}
          <div className="table-controls">
            <span>{online ? t("ONLINESPEL") : t("LOKALT SPEL")}</span>
            <button onClick={onLobby} disabled={online && game.ownerId !== viewerId}>
              <Icon name="arrow-left" /> <span>{t("Till väntrummet")}</span>
            </button>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default function DigitalGame({ initialMode, onExit }: { initialMode: EntryMode; onExit: () => void }) {
  const { t, errorMessage } = useI18n();
  const { digitalStore } = useAccountHistory();
  const [mode, setMode] = useState<EntryMode>(initialMode);
  const [game, setGame] = useState<GameState | null>(null);
  const [remoteView, setRemoteView] = useState<GameView | null>(null);
  const [onlineSession, setOnlineSession] = useState<OnlineSession | null>(() => API_URL ? savedSession() : null);
  const [viewerId, setViewerId] = useState<string | null>(() => API_URL ? savedSession()?.playerId ?? null : null);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [flight, setFlight] = useState<CardFlight | null>(null);
  const [reviewedTrickCount, setReviewedTrickCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exchangePlaybackBusy, setExchangePlaybackBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const gameRef = useRef(game);
  const busyRef = useRef(false);
  const onlineSessionRef = useRef(onlineSession);
  gameRef.current = game;
  onlineSessionRef.current = onlineSession;
  const online = !!onlineSession;
  const view = online ? remoteView : game && viewerId ? viewForPlayer(game, viewerId) : null;

  useEffect(() => {
    if (!view) return;
    const result = digitalResult(view, online ? "online" : "local", viewerId ?? undefined);
    if (!result) return;
    const owner = digitalStore.getSnapshot().ownerId;
    void digitalResultId(result).then(id => digitalStore.append(id, result, owner))
      .catch(() => setError("Kunde inte spara spelhistoriken på den här enheten."));
  }, [game, remoteView, viewerId, online, digitalStore]);

  useEffect(() => {
    if (!onlineSession) return;
    let active = true;
    void loadOnline(onlineSession).then((next) => { if (active) setRemoteView((current) =>
      (next.revision ?? 0) >= (current?.revision ?? 0) ? next : current); })
      .catch((cause) => { if (active) setError((cause as Error).message); });
    const stop = watchOnline(onlineSession, (next) => { if (active) setRemoteView((current) =>
      (next.revision ?? 0) >= (current?.revision ?? 0) ? next : current); },
      (value) => { if (active) setConnected(value); });
    return () => { active = false; stop(); };
  }, [onlineSession]);

  async function send(command: object, allowDuringBusy = false) {
    if (!onlineSession || (busyRef.current && !allowDuringBusy)) return;
    const session = onlineSession;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await commandOnline(session, command);
      if (onlineSessionRef.current === session)
        setRemoteView((current) => (next.revision ?? 0) >= (current?.revision ?? 0) ? next : current);
    } catch (cause) {
      if (onlineSessionRef.current !== session) return;
      setError((cause as Error).message);
      try {
        const next = await loadOnline(session);
        if (onlineSessionRef.current === session)
          setRemoteView((current) => (next.revision ?? 0) >= (current?.revision ?? 0) ? next : current);
      } catch { /* Reconnect will refresh. */ }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function finishHumanExchange() {
    const score = view?.players.find((player) => player.id === viewerId)?.score ?? 0;
    const discardIds = canExchangeCards(score) ? selectedCardIds : [];
    if (online) {
      if (busyRef.current) return;
      void send({ type: "exchange", discardIds });
      setSelectedCardIds([]);
      return;
    }
    const current = gameRef.current;
    if (!current || !viewerId || busyRef.current) return;
    const next = applyCommand(current, { type: "exchange", actorId: viewerId, discardIds });
    if (next === current) return;
    gameRef.current = next;
    setGame(next);
    setSelectedCardIds([]);
  }

  function answerHumanExchange(accept: boolean) {
    if (online) { void send({ type: "exchange-choice", accept }); return; }
    const current = gameRef.current;
    if (!current || !viewerId || busyRef.current) return;
    const next = applyCommand(current, { type: "exchange-choice", actorId: viewerId, accept });
    if (next !== current) { gameRef.current = next; setGame(next); }
  }

  function playOneCard(next: GameState, from: CardFlight["from"] | null) {
    const previous = gameRef.current;
    if (!previous || next === previous) return;
    const played = next.currentTrick.length > previous.currentTrick.length
      ? next.currentTrick.at(-1)
      : next.completedTricks.length > previous.completedTricks.length
        ? next.completedTricks.at(-1)?.cards.at(-1)
        : undefined;
    gameRef.current = next;
    setGame(next);
    if (!played) return;
    busyRef.current = true;
    const origin = from ?? cardOrigin(`[data-player-id="${played.playerId}"] .opponent-cards .card-back:last-child`)
      ?? cardOrigin(".your-hand");
    if (origin) setFlight({ ...played, from: origin });
    else busyRef.current = false;
  }

  function playHumanCard(cardId: string, from?: CardFlight["from"]) {
    if (online) { void send({ type: "play-card", cardId }); return; }
    const current = gameRef.current;
    if (!current || !viewerId || busyRef.current) return;
    const origin = from ?? cardOrigin(`.your-hand [data-card-id="${cardId}"]`);
    playOneCard(applyCommand(current, { type: "play-card", actorId: viewerId, cardId }), origin);
  }

  useEffect(() => {
    if (online || exchangePlaybackBusy || !game || game.phase !== "table" || game.tableStage !== "exchange") return;
    const botOffer = game.pendingExchange &&
      game.players.find(player => player.id === game.pendingExchange?.playerId)?.control === "bot";
    if (!botOffer && !needsTimedBotExchange(game)) return;
    // The offer becomes visible only after earlier deliveries finish. Give it
    // its existing reading time from that point, rather than an expired deadline.
    const delay = botOffer
      ? CPU_REVEAL_MS
      : CPU_EXCHANGE_PAUSE_MS;
    const timer = window.setTimeout(() => setGame(current => current
      ? applyCommand(current, { type: "advance-bot", actorId: current.ownerId }) : current), delay);
    return () => window.clearTimeout(timer);
  }, [game?.phase, game?.tableStage, game?.pendingExchange, game?.activePlayerId, game?.exchangeEventSerial, online, exchangePlaybackBusy]);

  useEffect(() => {
    if (online || exchangePlaybackBusy || !game || !viewerId || game.phase !== "table" || game.tableStage !== "tricks" || game.waitingForNextTrick || flight || busyRef.current) return;
    const active = game.players.find((player) => player.id === game.activePlayerId);
    if (!active || active.control !== "bot") return;
    const timer = window.setTimeout(() => {
      const current = gameRef.current;
      if (!current || busyRef.current || current.activePlayerId !== active.id || current.waitingForNextTrick) return;
      const origin = cardOrigin(`[data-player-id="${active.id}"] .opponent-cards .card-back:last-child`);
      playOneCard(applyCommand(current, { type: "advance-bot", actorId: current.ownerId }), origin);
    }, !game.currentTrick.length && !game.completedTricks.length &&
      game.players.some((player) => player.control === "human" && player.score >= 15) ? 5000 : BOT_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [game?.phase, game?.tableStage, game?.activePlayerId, game?.currentTrick.length, game?.completedTricks.length, game?.waitingForNextTrick, flight, viewerId, online, exchangePlaybackBusy]);

  useEffect(() => {
    if (view?.phase === "table" && view.tableStage === "exchange" &&
      view.exchangeCount === 0 && view.completedTricks.length === 0) setReviewedTrickCount(0);
  }, [view?.phase, view?.tableStage, view?.exchangeCount, view?.completedTricks.length]);

  useEffect(() => {
    if (view?.phase !== "table" || !view.completedTricks.length ||
      view.completedTricks.length <= reviewedTrickCount || flight) return;
    const timer = window.setTimeout(() => {
      setReviewedTrickCount(view.completedTricks.length);
      if (!online) setGame((current) => current?.waitingForNextTrick
        ? applyCommand(current, { type: "continue-trick", actorId: current.ownerId }) : current);
    }, TRICK_REVIEW_MS);
    return () => window.clearTimeout(timer);
  }, [view?.phase, view?.completedTricks.length, reviewedTrickCount, flight, online]);

  async function enterRoom(name: string, entry: RoomEntry) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFlight(null);
    setReviewedTrickCount(0);
    setSelectedCardIds([]);
    setError(null);
    try {
      if (!API_URL && entry.kind === "join")
        throw new Error("Onlinespel är inte konfigurerat ännu. Du kan skapa ett lokalt rum med datorstyrda spelare.");
      if (API_URL) {
        const result = await enterOnline(name, entry.kind === "join" ? entry.code : undefined);
        setViewerId(result.session.playerId);
        setRemoteView(result.view);
        setOnlineSession(result.session);
      } else {
        const room = createRoom(name, entry.kind === "join" ? entry.code : randomRoomCode());
        setViewerId(room.ownerId);
        setGame(room);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function clearRoom() {
    busyRef.current = false;
    setFlight(null);
    setSelectedCardIds([]);
    setReviewedTrickCount(0);
    setError(null);
    setBusy(false);
    setGame(null);
    setRemoteView(null);
    onlineSessionRef.current = null;
    setOnlineSession(null);
    saveSession(null);
    setViewerId(null);
    setMode(null);
    onExit();
  }
  async function leave() {
    if (onlineSession) {
      try { await leaveOnline(onlineSession); }
      catch (cause) { setError((cause as Error).message); return; }
    }
    clearRoom();
  }
  if (onlineSession && !view) return <div className="entry-page"><div className="page-width entry-layout"><div>
    <Brand /><h1>{t("Återansluter till rummet…")}</h1>
    {error && <p role="alert">{errorMessage(error)}</p>}
    <button className="button button-secondary" onClick={clearRoom}>{t("Till startsidan")}</button>
  </div></div></div>;
  if (!view || !viewerId)
    return mode ? (
      <Entry key={mode} mode={mode} onBack={onExit} onSubmit={enterRoom} error={error} busy={busy} />
    ) : null;
  if (view.phase === "lobby")
    return <><Lobby game={view} viewerId={viewerId} online={online}
      onSettings={(settings) => {
        if (online) void send({ type: "set-settings", settings });
        else setGame((current) => current && applyCommand(current, { type: "set-settings", actorId: viewerId, settings }));
      }}
      onAddBot={() => {
        if (online) void send({ type: "add-bot" });
        else setGame((current) => current && applyCommand(current, { type: "add-bot", actorId: viewerId }));
      }}
      onRemoveBot={(playerId) => {
        if (online) void send({ type: "remove-bot", playerId });
        else setGame((current) => current && applyCommand(current, { type: "remove-player", actorId: viewerId, playerId }));
      }}
      onStart={() => {
        setReviewedTrickCount(0);
        if (online) void send({ type: "start-round" });
        else setGame((current) => current && applyCommand(current, { type: "start-round", actorId: viewerId }));
      }}
      onLeave={() => void leave()} />{error && <div className="network-message" role="alert">{errorMessage(error)}</div>}
      {online && !connected && <div className="network-message" role="status">{t("Återansluter till spelservern…")}</div>}</>;
  return <><Table
    key={`${view.matchId}:${view.dealNumber}`}
    onExchangePlaybackBusy={setExchangePlaybackBusy}
    game={view}
    viewerId={viewerId}
    online={online}
    selectedCardIds={selectedCardIds}
    onToggle={(id) => {
      if (view.activePlayerId !== viewerId) return;
      if (!canExchangeCards(view.players.find((player) => player.id === viewerId)?.score ?? 0)) return;
      setSelectedCardIds((current) => current.includes(id)
        ? current.filter((cardId) => cardId !== id) : [...current, id]);
    }}
    onExchange={finishHumanExchange}
    onKeep={finishHumanExchange}
    onExchangeChoice={answerHumanExchange}
    exchangeBusy={busy || view.activePlayerId !== viewerId}
    actionBusy={busy}
    visibleDiscard={view.discardCount}
    onPlayTrickCard={playHumanCard}
    onDeclareChicago={() => {
      if (online) void send({ type: "declare-chicago" });
      else setGame((current) => current && applyCommand(current, { type: "declare-chicago", actorId: viewerId }));
    }}
    flight={flight}
    reviewedTrickCount={reviewedTrickCount}
    onCardLanded={() => { busyRef.current = false; setFlight(null); }}
    onNextRound={() => {
      busyRef.current = false; setFlight(null); setReviewedTrickCount(0); setSelectedCardIds([]);
      if (online) void send({ type: "start-round" });
      else setGame((current) => current && applyCommand(current, { type: "start-round", actorId: viewerId }));
    }}
    onLobby={() => {
      busyRef.current = false; setFlight(null); setSelectedCardIds([]); setReviewedTrickCount(0);
      if (online) void send({ type: "return-lobby" }, true);
      else setGame((current) => current && applyCommand(current, { type: "return-lobby", actorId: viewerId }));
    }}
    onLeave={() => void leave()}
  />{error && <div className="network-message" role="alert">{errorMessage(error)}</div>}
    {online && !connected && <div className="network-message" role="status">{t("Återansluter till spelservern…")}</div>}</>;
}
