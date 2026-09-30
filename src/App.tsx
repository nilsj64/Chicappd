import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { evaluateHand, handCategoryName } from "./poker";
import type { Card, ExchangeEvent, GameSettings, GameState, GameView, PlayerView } from "./game";
import {
  applyCommand,
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
import IRLTable from "./IRLTable";
import Brand, { BrandMark } from "./Brand";
import { Icon, SuitIcon } from "./Icon";
import { canExchangeCards, matchWinnerId } from "./scoring";
import { MatchPodium } from "./MatchPodium";

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
  return <span>Sista sticket: {points} p</span>;
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
      aria-label={`${rankName[card.rank] ?? card.rank} i ${suitName[card.suit]}${selected ? ", valt" : ""}`}
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
  return (
    <div
      className={`card-back ${small ? "card-small" : ""}`}
      data-card-id={cardId}
      aria-label="Kort med baksidan uppåt"
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

function Landing({ onEnter, onPhysical }: { onEnter: (mode: EntryMode) => void; onPhysical: () => void }) {
  return (
    <div className="landing-page">
      <header className="landing-header page-width">
        <Brand />
        <span className="header-note">
          Kortkväll tillsammans, var ni än är <span><BrandMark /></span>
        </span>
      </header>
      <main className="landing-main page-width">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-line" /> ETT SPEL FÖR DITT GÄNG
          </div>
          <h1>
            Samla vännerna
            <br />
            runt <em>bordet.</em>
          </h1>
          <p>
            Samla vännerna kring ett digitalt kortbord. Skapa ett rum och
            börja spela tillsammans.
          </p>
          <div className="hero-actions">
            <button
              className="button button-primary"
              onClick={() => onEnter("create")}
            >
              Skapa spel <Icon name="arrow-up-right" />
            </button>
            {API_URL && <button
              className="button button-secondary"
              onClick={() => onEnter("join")}
            >
              Gå med i spel <Icon name="arrow-right" />
            </button>}
          </div>
          <div className="hero-footnote">
            <span className="footnote-icon"><BrandMark /></span> {API_URL
              ? "Onlinerum för upp till fyra spelare" : "Spela lokalt med upp till tre CPU-spelare"}
          </div>
          <button className="text-button" onClick={onPhysical}>Spela med fysiska kort <Icon name="arrow-right" /></button>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-ring art-ring-one" />
          <div className="art-ring art-ring-two" />
          <div className="art-label art-label-top">FEM KORT. ETT BORD.</div>
          <div className="art-card art-card-back" style={{ backgroundImage: `url(${cardBackAsset("light")})` }} />
          <div className="art-card art-card-heart">
            <span className="art-corner">
              A<br /><SuitIcon suit="hearts" />
            </span>
            <span className="art-suit"><SuitIcon suit="hearts" /></span>
          </div>
          <div className="art-card art-card-spade">
            <span className="art-corner">
              K<br /><SuitIcon suit="spades" />
            </span>
            <span className="art-suit"><SuitIcon suit="spades" /></span>
          </div>
          <div className="art-label art-label-bottom">
            KORTKVÄLLEN BÖRJAR HÄR <span><Icon name="arrow-up-right" /></span>
          </div>
        </div>
      </main>
      <footer className="landing-footer page-width">
        <span className="suit-row"><SuitIcon suit="spades" /><SuitIcon suit="hearts" />
          <SuitIcon suit="diamonds" /><SuitIcon suit="clubs" /></span>
        <span>För spelkvällar tillsammans.</span>
      </footer>
    </div>
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
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const joining = mode === "join";
  return (
    <div className="entry-page">
      <header className="page-width inner-header">
        <Brand />
        <button className="text-button" onClick={onBack}>
          <Icon name="arrow-left" /> Tillbaka
        </button>
      </header>
      <main className="entry-layout page-width">
        <div className="entry-intro">
          <div className="eyebrow">
            <span className="eyebrow-line" /> DAGS ATT SPELA
          </div>
          <h1>
            {joining ? (
              <>
                Hitta din plats
                <br />
                <em>vid bordet.</em>
              </>
            ) : (
              <>
                Bjud in till
                <br />
                <em>kortkväll.</em>
              </>
            )}
          </h1>
          <p>
            {joining
              ? "Skriv in koden du fick av den som skapade rummet."
              : "Skapa ett rum och bjud in vänner eller lägg till datorstyrda spelare."}
          </p>
          <div className="entry-deco suit-row"><SuitIcon suit="clubs" /><SuitIcon suit="diamonds" />
            <SuitIcon suit="spades" /><SuitIcon suit="hearts" /></div>
        </div>
        <form
          className="entry-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (joining) {
              onSubmit(name.trim() || "Du", {
                kind: "join",
                code: code.trim().toUpperCase(),
              });
            } else {
              onSubmit(name.trim() || "Du", { kind: "create" });
            }
          }}
        >
          <div className="form-icon"><BrandMark /></div>
          <div className="form-kicker">
            {joining ? "GÅ MED I RUM" : "SKAPA RUM"}
          </div>
          <h2>{joining ? "Gå med i ett rum" : "Skapa ett rum"}</h2>
          <label htmlFor="player-name">Vad heter du?</label>
          <input
            id="player-name"
            maxLength={20}
            placeholder="Ditt namn"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          {joining && (
            <>
              <label htmlFor="room-code">Rumskod</label>
              <input
                id="room-code"
                className="code-input"
                maxLength={5}
                minLength={5}
                placeholder="T.ex. Q7K2P"
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
            type="submit" disabled={busy}
          >
            {joining ? "Gå med i rummet" : "Skapa rummet"} <Icon name="arrow-up-right" />
          </button>
          {error && <p className="form-note" role="alert">{error}</p>}
          <p className="form-note">{API_URL ? "Spela tillsammans online" : "Spela lokalt med datorstyrda spelare"}</p>
        </form>
      </main>
    </div>
  );
}

function Seat({ player, index, viewerId, onRemoveBot }: {
  player?: PlayerView; index: number; viewerId: string; onRemoveBot?: (id: string) => void;
}) {
  return (
    <div className={`lobby-seat ${player ? "seat-filled" : ""}`}>
      <span className="seat-index">0{index + 1}</span>
      {player ? (
        <>
          <Avatar player={player} viewerId={viewerId} />
          <div className="seat-name">{player.name}</div>
          <div className="seat-detail">
            {player.id === viewerId ? "Du" : player.control === "bot" ? "Datorspelare" : "Spelare"}
          </div>
          {player.control === "bot" && onRemoveBot && <button type="button" className="seat-remove"
            onClick={() => onRemoveBot(player.id)} aria-label={`Ta bort ${player.name}`}>Ta bort</button>}
        </>
      ) : (
        <>
          <span className="empty-avatar"><Icon name="plus" /></span>
          <div className="seat-name">Ledig plats</div>
          <div className="seat-detail">Ingen sitter här än</div>
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
  const [copied, setCopied] = useState(false);
  const matchWinner = matchWinnerId(game.players);
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
          Lämna rum <Icon name="arrow-up-right" />
        </button>
      </header>
      <main className="lobby-main page-width">
        <div className="lobby-heading">
          <div className="eyebrow">
            <span className="eyebrow-line" /> SPELRUM
          </div>
          <h1>
            Välkommen till <em>bordet.</em>
          </h1>
          <p>{online ? "Dela rumskoden med vänner eller lägg till datorstyrda spelare. Ägaren startar när minst två spelare är här." : "Lägg till datorstyrda spelare och starta när ni är minst två."}</p>
        </div>
        <div className="lobby-content">
          {matchWinner && <MatchPodium players={game.players} winnerId={matchWinner} />}
          <section className="lobby-panel">
            <div className="panel-topline">
              <span>SPELARE</span>
              <span>{game.players.length} AV 4 PLATSER</span>
            </div>
            <div className="seats-grid">
              {Array.from({ length: 4 }, (_, index) => (
                <Seat key={index} player={game.players[index]} index={index} viewerId={viewerId}
                  onRemoveBot={game.ownerId === viewerId ? onRemoveBot : undefined} />
              ))}
            </div>
            <div className="lobby-panel-bottom">
              <span>
                <span className="status-dot" /> {online ? "Onlinerum" : "Lokalt rum"}
              </span>
              <button
                className="small-button"
                onClick={onAddBot}
                disabled={game.players.length >= 4 || game.ownerId !== viewerId}
              >
                <Icon name="plus" /> Lägg till datorspelare
              </button>
            </div>
          </section>
          <aside className="room-panel">
            <div className="room-panel-icon"><BrandMark /></div>
            <span className="form-kicker">DITT RUM</span>
            <h2>
              {online ? "Dela koden" : "Ditt spel"}
              <br />
              {online ? "med vännerna." : "börjar här."}
            </h2>
            {online ? <><div className="room-code-label">RUMSKOD</div>
              <button className="room-code" onClick={copyCode} title="Kopiera rumskod">
                <span>{game.roomCode}</span>
                <span className="copy-icon"><Icon name={copied ? "check" : "copy"} /></span>
              </button>
              <p>{copied ? "Koden är kopierad!" : "Tryck på koden för att kopiera den."}</p></>
              : <p>Lägg till datorstyrda spelare och välj regler innan ni börjar.</p>}
            <div className="room-rule">
              <span className="room-code-label">POÄNGREGEL</span>
              <label>Sista sticket
                <select value={game.settings.finalTrickPoints} disabled={game.ownerId !== viewerId}
                  onChange={(event) => onSettings({ ...game.settings, finalTrickPoints: Number(event.target.value) as 2 | 5 })}>
                  <option value={5}>5 poäng</option><option value={2}>2 poäng</option>
                </select>
              </label>
              <label>Minuspoäng
                <select value={game.settings.allowNegativeScores ? "yes" : "no"} disabled={game.ownerId !== viewerId}
                  onChange={(event) => onSettings({ ...game.settings, allowNegativeScores: event.target.value === "yes" })}>
                  <option value="no">Tillåt inte minuspoäng</option><option value="yes">Tillåt minuspoäng</option>
                </select>
              </label>
            </div>
            <button
              className="button button-primary start-button"
              onClick={onStart}
              disabled={game.players.length < 2 || game.ownerId !== viewerId || !!matchWinner}
            >
              Börja spela <Icon name="arrow-right" />
            </button>
            <small>
              {matchWinner ? "Matchen är avgjord. Skapa ett nytt rum för en ny match."
                : game.players.length < 2
                ? "Bjud in en vän eller lägg till en datorstyrd spelare."
                : "Starta matchen med fem kort var."}
            </small>
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
          <strong className="table-player-name">{player.name} <span className="table-player-score">{player.score} p</span></strong>
          {active && <small>Spelar nu</small>}
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
  return <div className="discard-pile" aria-label={`Hög med ${count} bortbytta kort`}>
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
  return <div className="physical-pile deck-pile" aria-label={`Kortlek med ${count} kort kvar`}>
    {Array.from({ length: count }, (_, index) => {
      const offset = pileOffset(index);
      return <div className="physical-pile-card" key={index}
        style={{ transform: `translate(${offset.x / 2}px, ${offset.y / 2}px) rotate(${offset.angle / 3}deg)`, zIndex: index + 1 }}>
        <CardBack small />
      </div>;
    })}
  </div>;
}

function ExchangeFlight({ event, playerName, own }: {
  event: ExchangeEvent; playerName: string; own: boolean;
}) {
  const [cards, setCards] = useState<CSSProperties[]>([]);
  useLayoutEffect(() => {
    const source = document.querySelector(own ? ".your-hand .playing-card" :
      `[data-player-id="${CSS.escape(event.playerId)}"] .opponent-cards .card-back`);
    const target = document.querySelector(".discard-pile");
    if (!source || !target) return;
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    setCards(Array.from({ length: event.changedCards }, (_, index) => ({
      left: from.left + (index - (event.changedCards - 1) / 2) * 8,
      top: from.top,
      width: from.width,
      height: from.height,
      "--exchange-x": `${to.left + to.width / 2 - from.left - from.width / 2}px`,
      "--exchange-y": `${to.top + to.height / 2 - from.top - from.height / 2}px`,
      animationDelay: `${index * 65}ms`,
    } as CSSProperties)));
  }, [event.id, event.changedCards, event.playerId, own]);
  return <div className="exchange-playback" aria-live="polite">
    {cards.map((style, index) => <div className="exchange-flight-card" style={style} key={index} aria-hidden="true">
      <CardBack small />
    </div>)}
    <div className="exchange-playback-label">{playerName} {event.changedCards
      ? `byter ${event.changedCards} kort` : "behåller handen"}</div>
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
  return <div className="played-stack" data-played-player-id={player.id}
    aria-label={`${player.name}: ${cards.length} spelade kort`}>
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

function ScorePanel({ players, viewerId }: { players: PlayerView[]; viewerId: string }) {
  return (
    <aside className="score-panel">
      <div className="score-header">
        <span>POÄNGSTÄLLNING</span>
        <span><BrandMark /></span>
      </div>
      <div className="score-list">
        {players.map((player, index) => (
          <div className="score-row" key={player.id}>
            <span className="score-place">0{index + 1}</span>
            <Avatar player={player} viewerId={viewerId} size="small" />
            <span className="score-name">
              {player.name}
              {player.id === viewerId && <small>DU</small>}
            </span>
            <span className={`chicago-check ${player.hasDeclaredChicago ? "checked" : ""}`}
              role="img" aria-label={player.hasDeclaredChicago ? `${player.name} har sagt Chicago` : `${player.name} har inte sagt Chicago`}
              title={player.hasDeclaredChicago ? "Har sagt Chicago" : "Har inte sagt Chicago"}>
              {player.hasDeclaredChicago ? "✓" : ""}
            </span>
            <strong>{player.score}</strong>
          </div>
        ))}
      </div>
      <div className="score-foot">
        ✓ = har sagt Chicago · 52 poäng krävs för vinst. Från 46 poäng är kortbyte spärrat. Sista sticket ger också poäng.
      </div>
    </aside>
  );
}

function ActivityLog({ activity, quiet }: { activity: string[]; quiet: boolean }) {
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
    <span>SENASTE HÄNDELSER</span>
    {activity.length === 0 ? <p>Välj kort att byta eller behåll handen.</p> :
      <ul ref={listRef}>
        {activity.map((event, index) => <li key={`${index}-${event}`}>{event}</li>).reverse()}
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
  visibleDiscard,
  onPlayTrickCard,
  onDeclareChicago,
  flight,
  reviewedTrickCount,
  onCardLanded,
  onNextRound,
  onLobby,
  onLeave, online,
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
  visibleDiscard: number;
  onPlayTrickCard: (id: string, from?: CardFlight["from"]) => void;
  onDeclareChicago: () => void;
  flight: CardFlight | null;
  reviewedTrickCount: number;
  onCardLanded: () => void;
  onNextRound: () => void;
  onLobby: () => void;
  onLeave: () => void;
}) {
  const local = game.players.find((player) => player.id === viewerId)!;
  const exchangeAllowed = canExchangeCards(local.score);
  const matchWinner = game.tableStage === "result" ? matchWinnerId(game.players) : null;
  const [supportOpen, setSupportOpen] = useState(false);
  const advice = supportOpen ? supportAdvice(game, viewerId) : null;
  const opponents = game.players.filter((player) => player.id !== viewerId);
  const exchanging = game.tableStage === "exchange";
  const yourExchangeTurn = exchanging && game.activePlayerId === local.id;
  const pendingExchange = game.pendingExchange;
  const yourChoice = pendingExchange?.playerId === viewerId;
  const playingTricks = game.tableStage === "tricks";
  const reviewingTrick = playingTricks && game.waitingForNextTrick;
  const humanTurn = playingTricks && game.activePlayerId === local.id && !reviewingTrick && !flight;
  const lastTrick = game.completedTricks.at(-1);
  const nextLeader = game.players.find((player) => player.id === game.activePlayerId);
  const firstTrickCard = game.currentTrick[0];
  const leadPlayer = game.players.find((player) => player.id === (firstTrickCard?.playerId ?? game.activePlayerId));
  const firstCardFlying = !!firstTrickCard && flight?.card.id === firstTrickCard.card.id;
  const pendingTrick = game.completedTricks.length > reviewedTrickCount;
  const showResult = game.tableStage === "result" && !pendingTrick && !flight;
  const currentCardIds = new Set((game.currentTrick.length
    ? game.currentTrick : pendingTrick ? lastTrick?.cards ?? [] : []).map((played) => played.card.id));
  const selectionCount = exchangeAllowed ? selectedCardIds.length : 0;
  const currentEvaluation = exchanging ? evaluateHand(local.hand) : null;
  const finalAward = game.handAwards.find((award) => award.exchangeCount === 3);
  const finalWinnerCategory = finalAward?.winnerId
    ? finalAward.evaluations[finalAward.winnerId]?.category : undefined;
  const finalTrickWinner = game.players.find((player) => player.id === game.finalTrickAward?.winnerId);
  const chicagoPlayer = game.players.find((player) => player.id === game.chicagoPlayerId);
  const chicagoBreaker = game.players.find((player) => player.id === game.chicagoBreakerId);
  const canDeclareChicago = playingTricks && !game.currentTrick.length && !game.completedTricks.length &&
    !game.chicagoPlayerId && local.score >= 15;
  const [showExchangeFeedback, setShowExchangeFeedback] = useState(false);
  const seenExchangeEvent = useRef(0);
  const [exchangeQueue, setExchangeQueue] = useState<ExchangeEvent[]>([]);
  useEffect(() => {
    const fresh = game.exchangeEvents.filter((event) => event.id > seenExchangeEvent.current);
    if (!fresh.length) return;
    seenExchangeEvent.current = fresh.at(-1)!.id;
    setExchangeQueue((queue) => [...queue, ...fresh]);
  }, [game.exchangeEvents]);
  useEffect(() => {
    if (!exchangeQueue.length) return;
    const timer = window.setTimeout(() => setExchangeQueue((queue) => queue.slice(1)),
      exchangeQueue[0].changedCards ? 620 + 65 * (exchangeQueue[0].changedCards - 1) : 450);
    return () => window.clearTimeout(timer);
  }, [exchangeQueue]);
  const exchangePlayback = exchangeQueue[0];
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
    {selectionCount ? `Byt ${selectionCount} kort`
      : exchangeAllowed ? "Behåll handen" : "Behåll handen · 46+ poäng"}
    <Icon name="arrow-right" />
  </button>;
  const legalTrickIds = new Set(playingTricks
    ? legalCards(local.hand, game.currentTrick[0]?.card.suit ?? null).map((card) => card.id)
    : []);
  return (
    <div className="table-page">
      <header className="table-header">
        <Brand light />
        <div className="table-header-center">
          <span className="table-room">RUM {game.roomCode}</span>
          <span className="table-header-divider" />
          <span>
            <span className="live-dot" /> {online ? "Onlinespel" : "Lokalt spel"}
          </span>
        </div>
        <button className="table-exit" onClick={onLeave}>
          Lämna spelet <Icon name="arrow-up-right" />
        </button>
      </header>
      <main className="table-layout">
        <section className="felt-wrap">
          <div className={`felt ${exchanging ? "" : "felt-tricks"} ${showResult ? "felt-result" : ""}`}>
            <div className="felt-line" />
            {exchanging && <div className="exchange-round">Kortbyte {game.exchangeCount + 1} av 3</div>}
            {showExchangeFeedback && game.exchangeFeedback && <div className="exchange-toast" role="status">
              Kortbyte {game.exchangeFeedback.exchangeCount} klart · {game.exchangeFeedback.changedCards === 0
                ? "du behöll handen"
                : `du bytte ${game.exchangeFeedback.changedCards} kort`}
            </div>}
            {exchangePlayback && <ExchangeFlight key={exchangePlayback.id} event={exchangePlayback}
              playerName={game.players.find((player) => player.id === exchangePlayback.playerId)?.name ?? "Spelare"}
              own={exchangePlayback.playerId === viewerId} />}
            <div className="opponents">
              {opponents.map((player, index) => (
                <Opponent
                  key={player.id}
                  player={player}
                  viewerId={viewerId}
                  active={game.activePlayerId === player.id}
                  position={opponents.length === 1 ? "top" : opponents.length === 2
                    ? index === 0 ? "left" : "right"
                    : ["left", "top", "right"][index] as "left" | "top" | "right"}
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
              {pendingExchange && <div className="exchange-offer" aria-live="polite">
                <strong>{game.players.find((player) => player.id === pendingExchange.playerId)?.name} byter ett kort</strong>
                <span>Första nya kortet</span>
                <PlayingCard card={pendingExchange.card} />
                {yourChoice ? <div className="exchange-offer-actions">
                  <span>Vill du ha det visade kortet?</span>
                  <button type="button" disabled={exchangeBusy} onClick={() => onExchangeChoice(true)}>Ja</button>
                  <button type="button" disabled={exchangeBusy} onClick={() => onExchangeChoice(false)}>Nej</button>
                </div> : <span>Väntar på svar…</span>}
              </div>}
              </> : <div className="trick-view" aria-live="polite">
                {!showResult && <div className="trick-discard"><DiscardPile count={game.discardCount} /></div>}
                {chicagoPlayer && <div className="chicago-status" role="status">
                  Chicago: <strong>{chicagoPlayer.name}</strong> satsar på alla stick
                  {chicagoBreaker && <small>Bruten av {chicagoBreaker.name} · +10 p</small>}
                </div>}
                {playingTricks && !reviewingTrick && (!firstTrickCard || firstCardFlying) && leadPlayer &&
                  <div className="trick-cue">{leadPlayer.name} spelar ut</div>}
                {playingTricks && !reviewingTrick && firstTrickCard && !firstCardFlying &&
                  <div className="trick-cue trick-suit-cue">Följ färgen om du kan: <strong>{suitName[firstTrickCard.card.suit]}</strong></div>}
                {(game.tableStage === "result" || reviewingTrick) && <h2>{playingTricks
                  ? reviewingTrick
                    ? flight ? "Kortet spelas…" : `${nextLeader?.name} vann stick ${game.completedTricks.length}`
                    : ""
                  : pendingTrick ? `${finalTrickWinner?.name} vann sista sticket` : "Rundan är slut"}</h2>}
                {showResult && <div className="round-summary">
                  {matchWinner && <MatchPodium players={game.players} winnerId={matchWinner} />}
                  <div className="round-awards">
                    <div><span>Sista sticket · separat regel</span><strong>{finalTrickWinner?.name} <b>+{game.finalTrickAward?.points ?? 0} p</b></strong></div>
                    <div><span>Bästa handen</span><strong>{finalAward?.winnerId
                      ? `${game.players.find((player) => player.id === finalAward.winnerId)?.name} · ${finalWinnerCategory ? handCategoryName[finalWinnerCategory] : ""}` : "Ingen"}
                      <b>+{finalAward?.points ?? 0} p</b></strong></div>
                    {game.chicagoAward && <div><span>Chicago</span><strong>{chicagoPlayer?.name}
                      <b>{game.chicagoAward.points > 0 ? "+" : ""}{game.chicagoAward.points} p</b></strong></div>}
                  </div>
                  <div className="round-hands"><h3>Händer vid rundans slut</h3><ul>{game.players.map((player) => <li key={player.id}>
                    <span>{player.name}</span><span>{finalAward?.evaluations[player.id]
                      ? handCategoryName[finalAward.evaluations[player.id].category] : ""}</span>
                  </li>)}</ul></div>
                  {!matchWinner && <button className="button button-next-round" onClick={onNextRound}>
                    Spela en runda till <Icon name="arrow-right" />
                  </button>}
                </div>}
              </div>}
            </div>
            <div className="your-area">
              {exchanging && <div className="hand-combination" aria-live="polite">{currentEvaluation?.label}</div>}
              <div className="your-label">
                <Avatar player={local} viewerId={viewerId} size="small" />
                <span>
                  <strong>
                    {local.name} <em>DU</em> <span className="table-player-score">{local.score} p</span>
                  </strong>
                  {game.tableStage !== "result" && <small>
                    {exchanging ? yourChoice ? "Välj Ja eller Nej för det öppna kortet"
                      : yourExchangeTurn && !pendingExchange ? exchangeAllowed ? "Välj kort att byta eller behåll handen" : "Från 46 poäng får du inte byta kort"
                      : `${nextLeader?.name ?? "Nästa spelare"} byter först…`
                      : reviewingTrick ? "Nästa stick börjar snart"
                      : playingTricks && !humanTurn ? `${nextLeader?.name ?? "Nästa spelare"} spelar…`
                      : "Tryck på ett kort eller dra det till bordet"}
                  </small>}
                </span>
              </div>
              {!exchanging && !showResult && <PlayedStack cards={playedCardsForPlayer(game, local.id)} player={local}
                currentCardIds={currentCardIds} flight={flight} onCardLanded={onCardLanded} />}
              <div className="your-hand">
                {local.hand.map((card) => (
                  <PlayingCard
                    key={card.id}
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
                ))}
              </div>
              {exchanging && handAction}
              {playingTricks && !game.currentTrick.length && !game.completedTricks.length &&
                <button type="button" className="button chicago-button" onClick={onDeclareChicago}
                  disabled={!canDeclareChicago || exchangeBusy || !!flight}>
                  Säg Chicago · alla fem stick (+15 / −15)
                </button>}
              {playingTricks && !game.chicagoPlayerId && local.score < 15 && !game.completedTricks.length &&
                <div className="chicago-hint">Chicago kräver minst 15 poäng.</div>}
              {game.trickError && <div className="selection-count selection-error" role="status">{game.trickError}</div>}
            </div>
          </div>
        </section>
        <aside className="table-sidebar">
          <div className="sidebar-top">
            <span className="sidebar-eyebrow">SPELBORD</span>
            <h1>
              Chicappd<span>.</span>
            </h1>
            <p>Fem kort på hand. Vem vinner rundan?</p>
          </div>
          <button type="button" className="support-toggle" aria-expanded={supportOpen}
            aria-controls="support-sheet" onClick={() => setSupportOpen((open) => !open)}>
            <span>Tips och regler</span><span>{supportOpen ? "Dölj" : "Visa"} <Icon name={supportOpen ? "minus" : "plus"} /></span>
          </button>
          {supportOpen && advice && <section id="support-sheet" className="support-sheet" aria-label="Tips och regler" aria-live="polite">
            <p>{advice.context}</p>
            {advice.tips.map((tip, index) => <div className="support-tip" key={index}>
              <span>{game.tableStage === "exchange" ? (index === 0 ? "BEHÅLL GÄRNA" : "ÖVERVÄG ATT BYTA") : (index === 0 ? "FÖRSLAG" : "ALTERNATIV")}</span>
              <p>{tip.text}</p>
            </div>)}
          </section>}
          <ScorePanel players={game.players} viewerId={viewerId} />
          {game.tableStage !== "exchange" && <div className="trick-tally">
            <span>VUNNA STICK</span>
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
            <span>{online ? "ONLINESPEL" : "LOKALT SPEL"}</span>
            <button onClick={onLobby} disabled={online && game.ownerId !== viewerId}>
              <Icon name="arrow-left" /> <span>Till väntrummet</span>
            </button>
          </div>
          <div className="sidebar-bottom">
            Spela tillsammans. <span><Icon name="heart" /></span>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default function App() {
  const [physicalOpen, setPhysicalOpen] = useState(false);
  const [mode, setMode] = useState<EntryMode>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [remoteView, setRemoteView] = useState<GameView | null>(null);
  const [onlineSession, setOnlineSession] = useState<OnlineSession | null>(() => API_URL ? savedSession() : null);
  const [viewerId, setViewerId] = useState<string | null>(() => API_URL ? savedSession()?.playerId ?? null : null);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [flight, setFlight] = useState<CardFlight | null>(null);
  const [reviewedTrickCount, setReviewedTrickCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const gameRef = useRef(game);
  const busyRef = useRef(false);
  const onlineSessionRef = useRef(onlineSession);
  gameRef.current = game;
  onlineSessionRef.current = onlineSession;
  const online = !!onlineSession;
  const view = online ? remoteView : game && viewerId ? viewForPlayer(game, viewerId) : null;

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
    if (online || !game?.pendingExchange ||
      game.players.find((player) => player.id === game.pendingExchange?.playerId)?.control !== "bot") return;
    const timer = window.setTimeout(() => setGame((current) => current
      ? applyCommand(current, { type: "advance-bot", actorId: current.ownerId }) : current), BOT_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [game?.pendingExchange, online]);

  useEffect(() => {
    if (online || !game || !viewerId || game.phase !== "table" || game.tableStage !== "tricks" || game.waitingForNextTrick || flight || busyRef.current) return;
    const active = game.players.find((player) => player.id === game.activePlayerId);
    if (!active || active.control !== "bot") return;
    const timer = window.setTimeout(() => {
      const current = gameRef.current;
      if (!current || busyRef.current || current.activePlayerId !== active.id || current.waitingForNextTrick) return;
      const origin = cardOrigin(`[data-player-id="${active.id}"] .opponent-cards .card-back:last-child`);
      playOneCard(applyCommand(current, { type: "advance-bot", actorId: current.ownerId }), origin);
    }, BOT_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [game?.phase, game?.tableStage, game?.activePlayerId, game?.currentTrick.length, game?.completedTricks.length, game?.waitingForNextTrick, flight, viewerId, online]);

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
  }
  async function leave() {
    if (onlineSession) {
      try { await leaveOnline(onlineSession); }
      catch (cause) { setError((cause as Error).message); return; }
    }
    clearRoom();
  }
  if (physicalOpen) return <IRLTable onExit={() => setPhysicalOpen(false)} />;
  if (onlineSession && !view) return <div className="entry-page"><div className="page-width entry-layout"><div>
    <Brand /><h1>Återansluter till rummet…</h1>
    {error && <p role="alert">{error}</p>}
    <button className="button button-secondary" onClick={clearRoom}>Till startsidan</button>
  </div></div></div>;
  if (!view || !viewerId)
    return mode ? (
      <Entry key={mode} mode={mode} onBack={() => setMode(null)} onSubmit={enterRoom} error={error} busy={busy} />
    ) : <Landing onEnter={setMode} onPhysical={() => setPhysicalOpen(true)} />;
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
      onLeave={() => void leave()} />{error && <div className="network-message" role="alert">{error}</div>}
      {online && !connected && <div className="network-message" role="status">Återansluter till spelservern…</div>}</>;
  return <><Table
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
  />{error && <div className="network-message" role="alert">{error}</div>}
    {online && !connected && <div className="network-message" role="status">Återansluter till spelservern…</div>}</>;
}
