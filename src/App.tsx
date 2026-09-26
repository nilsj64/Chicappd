import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { evaluateHand } from "./poker";
import type { Card, GameState, Player } from "./game";
import {
  addDemoPlayer,
  continueAfterTrickOnce,
  createRoom,
  exchangeSelectedCards,
  keepHand,
  playNextDemoTrickCard,
  playTrickCardOnce,
  randomRoomCode,
  startRound,
  suitSymbol,
  toggleCard,
  playedCardsForPlayer,
} from "./game";
import { legalCards } from "./tricks";
import type { PlayedCard } from "./tricks";

type CardFlight = PlayedCard & { from: { x: number; y: number; width: number; height: number } };
const CARD_FLIGHT_MS = 360;
const BOT_PAUSE_MS = 290;
const TRICK_REVIEW_MS = 1300;

function cardOrigin(selector: string): CardFlight["from"] | null {
  const rect = document.querySelector(selector)?.getBoundingClientRect();
  return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
}

type EntryMode = "create" | "join" | null;
type RoomEntry =
  | { kind: "create" }
  | { kind: "join"; code: string };

function FinalTrickRule() {
  return <span>Sista sticket: 5 p</span>;
}

function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? "brand-light" : ""}`}>
      <span className="brand-mark">✳</span>
      <span>
        chicago<span className="brand-dot">.</span>
      </span>
    </div>
  );
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
      aria-label={`${card.rank} ${card.suit}${selected ? ", vald" : ""}`}
      aria-pressed={selected}
      disabled={!onClick || unavailable}
    >
      <span className="card-corner">
        <b>{card.rank}</b>
        <span>{suitSymbol[card.suit]}</span>
      </span>
      <span className="card-center">{suitSymbol[card.suit]}</span>
      <span className="card-corner card-corner-bottom">
        <b>{card.rank}</b>
        <span>{suitSymbol[card.suit]}</span>
      </span>
    </button>
  );
}

function CardBack({ small = false }: { small?: boolean }) {
  return (
    <div
      className={`card-back ${small ? "card-small" : ""}`}
      aria-label="Kort med baksidan upp"
    >
      <span>✳</span>
    </div>
  );
}

function Avatar({
  player,
  size = "normal",
}: {
  player: Player;
  size?: "normal" | "small";
}) {
  const colors = ["peach", "lavender", "mint", "sand"];
  const index = player.isLocal
    ? 0
    : (Number(player.id.replace(/\D/g, "")) % 3) + 1;
  return (
    <span className={`avatar avatar-${colors[index]} avatar-${size}`}>
      {player.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Landing({ onEnter }: { onEnter: (mode: EntryMode) => void }) {
  return (
    <div className="landing-page">
      <header className="landing-header page-width">
        <Brand />
        <span className="header-note">
          En kortkväll, var ni än är <span>✳</span>
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
            Ett digitalt bord för era Chicago-kvällar. Skapa ett rum, samla ditt
            sällskap och gör er redo för nästa giv.
          </p>
          <div className="hero-actions">
            <button
              className="button button-primary"
              onClick={() => onEnter("create")}
            >
              Skapa spel <span aria-hidden="true">↗</span>
            </button>
            <button
              className="button button-secondary"
              onClick={() => onEnter("join")}
            >
              Gå med i spel <span aria-hidden="true">→</span>
            </button>
          </div>
          <div className="hero-footnote">
            <span className="footnote-icon">✦</span> Privata rum för 2–4 spelare
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-ring art-ring-one" />
          <div className="art-ring art-ring-two" />
          <div className="art-label art-label-top">FEM KORT. ETT BORD.</div>
          <div className="art-card art-card-back">
            <span>✳</span>
          </div>
          <div className="art-card art-card-heart">
            <span className="art-corner">
              A<br />♥
            </span>
            <span className="art-suit">♥</span>
          </div>
          <div className="art-card art-card-spade">
            <span className="art-corner">
              K<br />♠
            </span>
            <span className="art-suit">♠</span>
          </div>
          <div className="art-label art-label-bottom">
            KORTKVÄLLEN BÖRJAR HÄR <span>↗</span>
          </div>
        </div>
      </main>
      <footer className="landing-footer page-width">
        <span>♠ ♥ ♦ ♣</span>
        <span>Gjort för spelkvällar tillsammans.</span>
      </footer>
    </div>
  );
}

function Entry({
  mode,
  onBack,
  onSubmit,
}: {
  mode: Exclude<EntryMode, null>;
  onBack: () => void;
  onSubmit: (name: string, entry: RoomEntry) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const joining = mode === "join";
  return (
    <div className="entry-page">
      <header className="page-width inner-header">
        <Brand />
        <button className="text-button" onClick={onBack}>
          ← Tillbaka
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
              ? "Ange rumskoden du fått av den som skapade spelet."
              : "Skapa ett privat spelrum och dela koden med dina vänner."}
          </p>
          <div className="entry-deco">
            ♣ <span>♦</span> ♠ <span>♥</span>
          </div>
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
          <div className="form-icon">✳</div>
          <div className="form-kicker">
            {joining ? "GÅ MED I SPEL" : "SKAPA SPEL"}
          </div>
          <h2>{joining ? "Välkommen in" : "Ditt spelrum"}</h2>
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
            type="submit"
          >
            {joining ? "Gå med i rum" : "Skapa rum"} <span>↗</span>
          </button>
          <p className="form-note">
            Lokal förhandsvisning · riktiga inbjudningar kommer senare
          </p>
        </form>
      </main>
    </div>
  );
}

function Seat({ player, index }: { player?: Player; index: number }) {
  return (
    <div className={`lobby-seat ${player ? "seat-filled" : ""}`}>
      <span className="seat-index">0{index + 1}</span>
      {player ? (
        <>
          <Avatar player={player} />
          <div className="seat-name">{player.name}</div>
          <div className="seat-detail">
            {player.isLocal ? "Du" : "Demospelare"}
          </div>
        </>
      ) : (
        <>
          <span className="empty-avatar">+</span>
          <div className="seat-name">Ledig plats</div>
          <div className="seat-detail">Väntar på spelare</div>
        </>
      )}
    </div>
  );
}

function Lobby({
  game,
  onAddDemo,
  onStart,
  onLeave,
}: {
  game: GameState;
  onAddDemo: () => void;
  onStart: () => void;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
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
          Lämna rum ↗
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
          <p>Samla sällskapet. När ni är redo börjar kortkvällen.</p>
        </div>
        <div className="lobby-content">
          <section className="lobby-panel">
            <div className="panel-topline">
              <span>SPELARE</span>
              <span>{game.players.length} AV 4 PLATSER</span>
            </div>
            <div className="seats-grid">
              {Array.from({ length: 4 }, (_, index) => (
                <Seat key={index} player={game.players[index]} index={index} />
              ))}
            </div>
            <div className="lobby-panel-bottom">
              <span>
                <span className="status-dot" /> Lokal förhandsvisning
              </span>
              <button
                className="small-button"
                onClick={onAddDemo}
                disabled={game.players.length >= 4}
              >
                + Lägg till demospelare
              </button>
            </div>
          </section>
          <aside className="room-panel">
            <div className="room-panel-icon">✳</div>
            <span className="form-kicker">DITT PRIVATA RUM</span>
            <h2>
              Dela koden
              <br />
              med ditt gäng.
            </h2>
            <div className="room-code-label">RUMSKOD</div>
            <button
              className="room-code"
              onClick={copyCode}
              title="Kopiera rumskod"
            >
              <span>{game.roomCode}</span>
              <span className="copy-icon">{copied ? "✓" : "⧉"}</span>
            </button>
            <p>
              {copied ? "Koden kopierad!" : "Klicka på koden för att kopiera."}
            </p>
            <div className="room-rule">
              <span className="room-code-label">POÄNGREGEL</span>
              <FinalTrickRule />
            </div>
            <button
              className="button button-primary start-button"
              onClick={onStart}
              disabled={game.players.length < 2}
            >
              Till spelbordet <span>→</span>
            </button>
            <small>
              {game.players.length < 2
                ? "Lägg till minst en demospelare för att börja."
                : "Börja en övningsgiv med fem kort var."}
            </small>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Opponent({
  player,
  active,
  announcement,
  position,
  playedCards,
  showPlayedCards,
  currentCardIds,
  flight,
  onCardLanded,
}: {
  player: Player;
  active: boolean;
  announcement?: string;
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
        {player.hand.map((card) => (
          <CardBack key={card.id} small />
        ))}
      </div>
      <div className="opponent-label">
        <Avatar player={player} size="small" />
        <span>
          <strong>{player.name}</strong>
          <small>{active ? "Aktiv spelare" : "Vid bordet"}</small>
        </span>
      </div>
      {announcement && <div className="opponent-announcement">{announcement}</div>}
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

function DiscardPile({ cards }: { cards: Card[] }) {
  return <div className="discard-pile" aria-label={`Kasthög med ${cards.length} bortbytta kort`}>
    <div className="physical-pile discard-pile-cards">
      {cards.map((card, index) => {
        const offset = pileOffset(index);
        return <div className="physical-pile-card" data-discard-card-id={card.id} key={card.id}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) rotate(${offset.angle}deg)`, zIndex: index + 1 }}>
          <CardBack small />
        </div>;
      })}
    </div>
    <span>KASTHÖG · {cards.length}</span>
  </div>;
}

function DeckPile({ cards }: { cards: Card[] }) {
  return <div className="physical-pile deck-pile" aria-label={`Kortlek med ${cards.length} kort`}>
    {cards.map((card, index) => {
      const offset = pileOffset(index);
      return <div className="physical-pile-card" data-deck-card-id={card.id} key={card.id}
        style={{ transform: `translate(${offset.x / 2}px, ${offset.y / 2}px) rotate(${offset.angle / 3}deg)`, zIndex: index + 1 }}>
        <CardBack small />
      </div>;
    })}
  </div>;
}

function playedOffset(index: number, cardId: string) {
  const variation = cardLanding(cardId);
  return {
    x: -18 + index * 9 + variation.x / 3,
    y: -10 + index * 5 + variation.y / 3,
    angle: [-4, 1, -2, 3, 0][index] + variation.rotation / 2,
  };
}

function PlayedStack({ cards, player, currentCardIds, flight, onCardLanded }: {
  cards: Card[];
  player: Player;
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

function ScorePanel({ players }: { players: Player[] }) {
  return (
    <aside className="score-panel">
      <div className="score-header">
        <span>POÄNGSTÄLLNING</span>
        <span>✳</span>
      </div>
      <div className="score-list">
        {players.map((player, index) => (
          <div className="score-row" key={player.id}>
            <span className="score-place">0{index + 1}</span>
            <Avatar player={player} size="small" />
            <span className="score-name">
              {player.name}
              {player.isLocal && <small>DU</small>}
            </span>
            <strong>{player.score}</strong>
          </div>
        ))}
      </div>
      <div className="score-foot">
        Bästa hand efter byte 1 och 2, sluthanden samt sista sticket ger poäng.
      </div>
    </aside>
  );
}

function Table({
  game,
  onToggle,
  onExchange,
  onKeep,
  onPlayTrickCard,
  flight,
  reviewedTrickCount,
  onCardLanded,
  onNextRound,
  onLobby,
  onLeave,
}: {
  game: GameState;
  onToggle: (id: string) => void;
  onExchange: () => void;
  onKeep: () => void;
  onPlayTrickCard: (id: string, from?: CardFlight["from"]) => void;
  flight: CardFlight | null;
  reviewedTrickCount: number;
  onCardLanded: () => void;
  onNextRound: () => void;
  onLobby: () => void;
  onLeave: () => void;
}) {
  const local = game.players.find((player) => player.isLocal)!;
  const opponents = game.players.filter((player) => !player.isLocal);
  const exchanging = game.tableStage === "exchange";
  const playingTricks = game.tableStage === "tricks";
  const reviewingTrick = playingTricks && game.waitingForNextTrick;
  const humanTurn = playingTricks && game.activePlayerId === local.id && !reviewingTrick && !flight;
  const lastTrick = game.completedTricks.at(-1);
  const nextLeader = game.players.find((player) => player.id === game.activePlayerId);
  const pendingTrick = game.completedTricks.length > reviewedTrickCount;
  const currentCardIds = new Set((game.currentTrick.length
    ? game.currentTrick : pendingTrick ? lastTrick?.cards ?? [] : []).map((played) => played.card.id));
  const selectionCount = game.selectedCardIds.length;
  const currentEvaluation = exchanging ? evaluateHand(local.hand) : null;
  const finalAward = game.handAwards.find((award) => award.exchangeCount === 3);
  const finalTrickWinner = game.players.find((player) => player.id === game.finalTrickAward?.winnerId);
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
  >
    {selectionCount ? `Byt ${selectionCount} kort`
      : "Behåll handen"}
    <span aria-hidden="true">→</span>
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
            <span className="live-dot" /> Övningsbord
          </span>
        </div>
        <button className="table-exit" onClick={onLeave}>
          Lämna spel <span>↗</span>
        </button>
      </header>
      <main className="table-layout">
        <section className="felt-wrap">
          <div className={`felt ${exchanging ? "" : "felt-tricks"}`}>
            <div className="felt-line" />
            {showExchangeFeedback && game.exchangeFeedback && <div className="exchange-toast" role="status">
              Byte {game.exchangeFeedback.exchangeCount} klart · {game.exchangeFeedback.changedCards === 0
                ? "du behöll handen"
                : `du bytte ${game.exchangeFeedback.changedCards} kort`}
            </div>}
            <div className="opponents">
              {opponents.map((player, index) => (
                <Opponent
                  key={player.id}
                  player={player}
                  active={game.activePlayerId === player.id}
                  position={opponents.length === 1 ? "top" : opponents.length === 2
                    ? index === 0 ? "left" : "right"
                    : ["left", "top", "right"][index] as "left" | "top" | "right"}
                  playedCards={playedCardsForPlayer(game, player.id)}
                  showPlayedCards={!exchanging}
                  currentCardIds={currentCardIds}
                  flight={flight}
                  onCardLanded={onCardLanded}
                  announcement={game.tableStage === "result" && !flight
                    ? finalAward?.evaluations[player.id]?.label : undefined}
                />
              ))}
            </div>
            <div className={`table-center ${exchanging ? "" : "table-center-tricks"}`}>
              {exchanging ? <><div className="table-stacks">
                <div className="stack-group">
                  <DeckPile cards={game.deck} />
                  <span>
                    KORTLEK <b>{game.deck.length}</b>
                  </span>
                </div>
                <div className="stack-group">
                  <DiscardPile cards={game.discard} />
                </div>
              </div>
              <div
                className="center-note combination-note"
                aria-live="polite"
              >
                <strong>
                  {currentEvaluation?.label}
                </strong>
                <small className="exchange-help">Byte {game.exchangeCount + 1} av 3 · välj kort att byta</small>
              </div>
              </> : <div className="trick-view" aria-live="polite">
                <div className="trick-discard"><DiscardPile cards={game.discard} /></div>
                <span className="trick-kicker">
                  {pendingTrick ? `STICK ${game.completedTricks.length} ${flight ? "AV 5" : "KLART"}` : playingTricks ? `STICK ${game.completedTricks.length + 1} AV 5` : "FEM STICK KLARA"}
                </span>
                <h2>{playingTricks
                  ? reviewingTrick
                    ? flight ? "Kortet läggs…" : `${nextLeader?.name} vann stick ${game.completedTricks.length}`
                    : game.currentTrick.length
                    ? `Följ ${suitSymbol[game.currentTrick[0].card.suit]} om du kan`
                    : `${nextLeader?.name ?? "Nästa spelare"} leder sticket`
                  : pendingTrick ? `${finalTrickWinner?.name} vann sista sticket` : "Rundan är klar"}</h2>
                {playingTricks && <div className="trick-status">
                  {reviewingTrick
                    ? flight ? "" : `${nextLeader?.name} leder nästa stick · fortsätter strax…`
                    : `${game.currentTrick.length} av ${game.players.length} kort spelade · ${nextLeader?.name} på tur`}
                </div>}
                {lastTrick && !pendingTrick && !flight && <div className="last-trick-note">
                  {game.currentTrick.length === 0 ? "Senaste stick: " : "Föregående stick: "}
                  {game.players.find((player) => player.id === lastTrick.winnerId)?.name} vann
                </div>}
                {game.tableStage === "result" && !pendingTrick && !flight && <div className="round-summary">
                  <div><span>SISTA STICKET</span><strong>{finalTrickWinner?.name} · +{game.finalTrickAward?.points ?? 0} p</strong></div>
                  <div><span>BÄSTA SLUTHAND</span><strong>{finalAward?.winnerId
                    ? `${game.players.find((player) => player.id === finalAward.winnerId)?.name} · ${finalAward.evaluations[finalAward.winnerId].label} · +${finalAward.points} p`
                    : "Ingen kvalificerande vinnare · 0 p"}</strong></div>
                  <div className="round-hands"><span>SLUTHÄNDER</span>{game.players.map((player) => <small key={player.id}>
                    {player.name}: {finalAward?.evaluations[player.id]?.label}
                  </small>)}</div>
                  <button className="button button-next-round" onClick={onNextRound}>
                    Nästa giv <span aria-hidden="true">→</span>
                  </button>
                </div>}
              </div>}
            </div>
            <div className="your-area">
              {!exchanging && <div className="your-label">
                <Avatar player={local} size="small" />
                <span>
                  <strong>
                    {local.name} <em>DU</em>
                  </strong>
                  <small>
                    {game.tableStage === "result"
                      ? "Alla fem stick spelade"
                      : reviewingTrick ? "Nästa stick börjar snart"
                      : playingTricks && !humanTurn ? `${nextLeader?.name ?? "Nästa spelare"} lägger kort…`
                      : "Klicka på ett kort eller dra det till bordet"}
                  </small>
                </span>
              </div>}
              {!exchanging && <PlayedStack cards={playedCardsForPlayer(game, local.id)} player={local}
                currentCardIds={currentCardIds} flight={flight} onCardLanded={onCardLanded} />}
              <div className="your-hand">
                {local.hand.map((card) => (
                  <PlayingCard
                    key={card.id}
                    card={card}
                    selected={exchanging && game.selectedCardIds.includes(card.id)}
                    unavailable={playingTricks && (!humanTurn || !legalTrickIds.has(card.id))}
                    onClick={
                      game.tableStage === "result" || (playingTricks && !humanTurn) ? undefined
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
              {!exchanging && <div className={`selection-count ${game.trickError ? "selection-error" : ""}`} role="status">
                {game.trickError ?? (game.tableStage === "result"
                  ? "Fem stick spelade · se resultatet ovan"
                  : reviewingTrick ? `${nextLeader?.name} vann och leder nästa stick`
                  : playingTricks
                    ? !humanTurn ? `${nextLeader?.name ?? "Nästa spelare"} lägger kort…` : "Klicka på ett kort eller dra det till bordet"
                    : "")}
              </div>}
            </div>
          </div>
        </section>
        <aside className="table-sidebar">
          <div className="sidebar-top">
            <span className="sidebar-eyebrow">SPELBORD</span>
            <h1>
              Chicago<span>.</span>
            </h1>
            <p>Fem kort på hand. Resten bestämmer ni tillsammans.</p>
          </div>
          <ScorePanel players={game.players} />
          {game.tableStage !== "exchange" && <div className="trick-tally">
            <span>VUNNA STICK</span>
            {game.players.map((player) => <div key={player.id}>
              <span>{player.name}</span>
              <strong>{game.completedTricks.filter((trick) => trick.winnerId === player.id).length}</strong>
            </div>)}
          </div>}
          <div className="table-rule">
            <FinalTrickRule />
          </div>
          {(!exchanging || game.activity.length > 0) && <div className={`table-activity ${exchanging ? "table-activity-quiet" : ""}`} aria-live="polite">
            <span>SENASTE HÄNDELSER</span>
            {game.activity.length === 0 ? (
              <p>Välj kort att byta eller behåll handen för att börja.</p>
            ) : (
              <ul>
                {game.activity.slice(-8).map((event, index) => (
                  <li key={`${game.activity.length - 8 + index}-${event}`}>{event}</li>
                ))}
              </ul>
            )}
          </div>}
          <div className="table-controls">
            <span>LOKAL FÖRHANDSVISNING</span>
            <button onClick={onLobby}>
              ← <span>Till väntrummet</span>
            </button>
          </div>
          <div className="sidebar-bottom">
            En första version för er nästa spelkväll. <span>♥</span>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<EntryMode>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [flight, setFlight] = useState<CardFlight | null>(null);
  const [reviewedTrickCount, setReviewedTrickCount] = useState(0);
  const gameRef = useRef(game);
  const busyRef = useRef(false);
  gameRef.current = game;

  function playOneCard(next: GameState, from: CardFlight["from"] | null) {
    const previous = gameRef.current;
    if (!previous) return;
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
    const current = gameRef.current;
    if (!current || busyRef.current || current.tableStage !== "tricks" || current.activePlayerId !== current.players.find((player) => player.isLocal)?.id) return;
    const origin = from ?? cardOrigin(`.your-hand [data-card-id="${cardId}"]`);
    playOneCard(playTrickCardOnce(current, cardId), origin);
  }

  useEffect(() => {
    if (!game || game.phase !== "table" || game.tableStage !== "tricks" || game.waitingForNextTrick || flight || busyRef.current) return;
    const active = game.players.find((player) => player.id === game.activePlayerId);
    if (!active || active.isLocal) return;
    const timer = window.setTimeout(() => {
      const current = gameRef.current;
      if (!current || busyRef.current || current.activePlayerId !== active.id || current.waitingForNextTrick) return;
      const origin = cardOrigin(`[data-player-id="${active.id}"] .opponent-cards .card-back:last-child`);
      playOneCard(playNextDemoTrickCard(current), origin);
    }, BOT_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [game?.phase, game?.tableStage, game?.activePlayerId, game?.currentTrick.length, game?.completedTricks.length, game?.waitingForNextTrick, flight]);

  useEffect(() => {
    if (game?.phase !== "table" || !game.completedTricks.length ||
      game.completedTricks.length <= reviewedTrickCount || flight) return;
    const timer = window.setTimeout(() => {
      setReviewedTrickCount(game.completedTricks.length);
      setGame((current) => current?.waitingForNextTrick ? continueAfterTrickOnce(current) : current);
    }, TRICK_REVIEW_MS);
    return () => window.clearTimeout(timer);
  }, [game?.phase, game?.completedTricks.length, reviewedTrickCount, flight]);

  function enterRoom(name: string, entry: RoomEntry) {
    // An unknown code opens a local demo room until multiplayer rooms exist.
    busyRef.current = false;
    setFlight(null);
    setReviewedTrickCount(0);
    const room = createRoom(
      name,
      entry.kind === "join" ? entry.code : randomRoomCode(),
    );
    setGame(entry.kind === "join" ? addDemoPlayer(room) : room);
  }

  if (!game)
    return mode ? (
      <Entry
        key={mode}
        mode={mode}
        onBack={() => setMode(null)}
        onSubmit={enterRoom}
      />
    ) : (
      <Landing onEnter={setMode} />
    );
  if (game.phase === "lobby")
    return (
      <Lobby
        game={game}
        onAddDemo={() =>
          setGame((current) => current && addDemoPlayer(current))
        }
        onStart={() => {
          setReviewedTrickCount(0);
          setGame((current) => current && startRound(current));
        }}
        onLeave={() => {
          setGame(null);
          setMode(null);
        }}
      />
    );
  return (
    <Table
      game={game}
      onToggle={(id) =>
        setGame((current) => current && toggleCard(current, id))
      }
      onExchange={() =>
        setGame((current) => current && exchangeSelectedCards(current))
      }
      onKeep={() => setGame((current) => current && keepHand(current))}
      onPlayTrickCard={playHumanCard}
      flight={flight}
      reviewedTrickCount={reviewedTrickCount}
      onCardLanded={() => {
        busyRef.current = false;
        setFlight(null);
      }}
      onNextRound={() => {
        busyRef.current = false;
        setFlight(null);
        setReviewedTrickCount(0);
        setGame((current) => current?.tableStage === "result" ? startRound(current) : current);
      }}
      onLobby={() => {
        busyRef.current = false;
        setFlight(null);
        setGame((current) => current && { ...current, phase: "lobby", selectedCardIds: [] });
      }}
      onLeave={() => {
        busyRef.current = false;
        setFlight(null);
        setGame(null);
        setMode(null);
      }}
    />
  );
}
