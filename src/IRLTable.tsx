import { useEffect, useState } from "react";
import type { GameSettings } from "./game";
import { handCategories, handCategoryPoints } from "./poker";
import type { HandCategory } from "./poker";
import { canDeclareChicago, defaultSettings, finalTrickPoints, matchWinnerId } from "./scoring";
import { correctIRLScore, createIRLGame, declareIRLChicago, finishIRLDeal, nextIRLDeal, recordFirstHands, undoIRL } from "./irl";
import type { HandResult, IRLGame } from "./irl";
import Brand, { BrandMark } from "./Brand";
import { MatchPodium } from "./MatchPodium";
import { Icon, SuitIcon } from "./Icon";

const storageKey = "chicappd-irl-game";
const categories: Record<HandCategory, string> = {
  "high-card": "Högt kort", "one-pair": "Par", "two-pair": "Två par", "three-of-a-kind": "Triss",
  straight: "Stege", flush: "Färg", "full-house": "Kåk", "four-of-a-kind": "Fyrtal", "straight-flush": "Färgstege",
};

function savedGame(): IRLGame | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null") as IRLGame | null;
    return value && Array.isArray(value.players) && Array.isArray(value.history) &&
      ["hands", "tricks", "result"].includes(value.phase) ? value : null;
  } catch { return null; }
}

function RuleSettings({ settings, onChange }: { settings: GameSettings; onChange: (settings: GameSettings) => void }) {
  return <div className="irl-settings">
    <label>Sista sticket
      <select value={settings.finalTrickPoints} onChange={(event) => onChange({ ...settings, finalTrickPoints: Number(event.target.value) as 2 | 5 })}>
        <option value={5}>5 poäng</option><option value={2}>2 poäng</option>
      </select>
    </label>
    <label>Minuspoäng
      <select value={settings.allowNegativeScores ? "yes" : "no"} onChange={(event) => onChange({ ...settings, allowNegativeScores: event.target.value === "yes" })}>
        <option value="no">Tillåt inte minuspoäng</option><option value="yes">Tillåt minuspoäng</option>
      </select>
    </label>
    <label>Kräv över 52 poäng för vinst
      <select value={settings.requireOver52ToWin ? "yes" : "no"} onChange={(event) => onChange({ ...settings, requireOver52ToWin: event.target.value === "yes" })}>
        <option value="no">Av · minst 52 poäng</option><option value="yes">På · minst 53 poäng</option>
      </select>
    </label>
    <label>Nollställ vid över 52 poäng utan Chicago
      <select value={settings.resetOver52WithoutChicago ? "yes" : "no"} onChange={(event) => onChange({ ...settings, resetOver52WithoutChicago: event.target.value === "yes" })}>
        <option value="no">Av · behåll poängen</option><option value="yes">På · nollställ till 0</option>
      </select>
    </label>
  </div>;
}

function HandPicker({ title, game, value, onChange }: { title: string; game: IRLGame; value: HandResult; onChange: (value: HandResult) => void }) {
  return <fieldset className="irl-hand-picker">
    <legend>{title}</legend>
    <label>Vem hade bästa handen?
      <select value={value?.playerId ?? ""} onChange={(event) => onChange(event.target.value
        ? { playerId: event.target.value, category: value?.category ?? "one-pair" } : null)}>
        <option value="">Ingen poäng / lika</option>
        {game.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
      </select>
    </label>
    {value && <label>Handens värde
      <select value={value.category} onChange={(event) => onChange({ ...value, category: event.target.value as HandCategory })}>
        {handCategories.filter((category) => handCategoryPoints(category) > 0).map((category) =>
          <option key={category} value={category}>{categories[category]} · +{handCategoryPoints(category)}</option>)}
      </select>
    </label>}
  </fieldset>;
}

export default function IRLTable({ onExit }: { onExit: () => void }) {
  const [game, setGame] = useState<IRLGame | null>(savedGame);
  const [names, setNames] = useState(["", ""]);
  const [settings, setSettings] = useState<GameSettings>({ ...defaultSettings });
  const [setupError, setSetupError] = useState("");
  const [firstHands, setFirstHands] = useState<[HandResult, HandResult]>([null, null]);
  const [finalHand, setFinalHand] = useState<HandResult>(null);
  const [lastWinner, setLastWinner] = useState("");
  const [chicagoWon, setChicagoWon] = useState<boolean | null>(null);
  const [breakerId, setBreakerId] = useState("");
  const [correctionId, setCorrectionId] = useState<string | null>(null);
  const [correctionValue, setCorrectionValue] = useState("");
  const [correctionReady, setCorrectionReady] = useState(false);
  const [resultError, setResultError] = useState("");
  const [newMatchReady, setNewMatchReady] = useState(false);
  useEffect(() => {
    if (game) localStorage.setItem(storageKey, JSON.stringify(game));
    else localStorage.removeItem(storageKey);
  }, [game]);

  function startMatch() {
    const created = createIRLGame(names, settings);
    if (!created) { setSetupError("Ange 2–4 olika spelarnamn, högst 20 tecken vardera."); return; }
    setGame(created);
    setSetupError("");
  }

  function finishDeal() {
    if (!game || !lastWinner) { setResultError("Välj vem som vann sista sticket."); return; }
    const next = finishIRLDeal(game, { finalHand, finalTrickWinnerId: lastWinner,
      ...(game.chicagoPlayerId ? { chicagoWon: chicagoWon ?? undefined, breakerId: breakerId || undefined } : {}) });
    if (next === game) { setResultError("Ange Chicago-utfall och vem som först bröt Chicago. Vid vinst måste Chicago-spelaren ha tagit sista sticket."); return; }
    setGame(next);
    setResultError("");
  }

  function nextDeal() {
    if (!game) return;
    setGame(nextIRLDeal(game));
    setFirstHands([null, null]); setFinalHand(null); setLastWinner("");
    setChicagoWon(null); setBreakerId(""); setResultError("");
  }

  const matchWinner = game?.phase === "result" ? matchWinnerId(game.players, game.settings) : null;
  return <div className="irl-page">
    <header className="irl-header">
      <Brand light />
      <span>FYSISKA KORT · POÄNGRÄKNARE</span>
      <button type="button" onClick={onExit}><Icon name="arrow-left" /> Huvudmeny</button>
      {game && <div className="irl-mobile-score">{game.players.map((player) => <span key={player.id}>{player.name} <strong>{player.score}</strong></span>)}</div>}
    </header>
    {!game ? <main className="irl-setup">
      <div className="eyebrow"><span className="suit-row"><SuitIcon suit="spades" /><SuitIcon suit="hearts" />
        <SuitIcon suit="diamonds" /><SuitIcon suit="clubs" /></span> SAMMA REGLER, RIKTIGA KORT</div>
      <h1>Samla spelarna <em>runt bordet.</em></h1>
      <p>Ta fram en kortlek. Appen håller poängen medan ni spelar.</p>
      <section className="irl-card">
        <h2>Vilka spelar?</h2>
        <div className="irl-name-list">{names.map((name, index) => <label key={index}>Spelare {index + 1}
          <input value={name} maxLength={20} placeholder={`Namn ${index + 1}`} onChange={(event) =>
            setNames((current) => current.map((item, position) => position === index ? event.target.value : item))} />
        </label>)}</div>
        <div className="irl-inline-actions">
          <button type="button" onClick={() => setNames((current) => [...current, ""])} disabled={names.length >= 4}><Icon name="plus" /> Spelare</button>
          <button type="button" onClick={() => setNames((current) => current.slice(0, -1))} disabled={names.length <= 2}>Ta bort sista</button>
        </div>
        <h2>Regler</h2>
        <RuleSettings settings={settings} onChange={setSettings} />
        {setupError && <p role="alert" className="irl-error">{setupError}</p>}
        <button type="button" className="button button-primary irl-primary" onClick={startMatch}>Starta match <Icon name="arrow-right" /></button>
      </section>
    </main> : <main className="irl-layout">
      <section className="irl-main">
        <div className="irl-round-heading"><span>GIV {game.dealNumber}</span><h1>{game.phase === "hands" ? "Registrera händerna" : game.phase === "tricks" ? "Stickspelet" : "Given är klar"}</h1>
          <p>Givare: {game.players[(game.dealNumber - 1) % game.players.length].name}</p></div>
        {game.chicagoPlayerId && <div className="irl-chicago-active" role="status"><BrandMark /> CHICAGO · {game.players.find((p) => p.id === game.chicagoPlayerId)?.name} ska ta alla stick</div>}
        {game.phase === "hands" && <div className="irl-card">
          <p>Efter varje av de två första bytena: välj spelaren med bäst poänggivande hand och handens kategori. Vid lika bästa hand får ingen poäng. Från 46 poäng får spelaren inte byta fysiska kort.</p>
          <HandPicker title="Efter byte 1" game={game} value={firstHands[0]} onChange={(value) => setFirstHands([value, firstHands[1]])} />
          <HandPicker title="Efter byte 2" game={game} value={firstHands[1]} onChange={(value) => setFirstHands([firstHands[0], value])} />
          <button type="button" className="button button-primary irl-primary" onClick={() => setGame(recordFirstHands(game, firstHands))}>Starta stickspelet <Icon name="arrow-right" /></button>
        </div>}
        {game.phase === "tricks" && <div className="irl-card">
          {!game.chicagoPlayerId && <div className="irl-chicago-choice"><h2>Chicago?</h2><p>Kan sägas före första sticket av en spelare med minst 15 poäng.</p>
            <div className="irl-player-buttons">{game.players.map((player) => <button type="button" key={player.id}
              disabled={!canDeclareChicago(player.score)} onClick={() => setGame(declareIRLChicago(game, player.id))}>
              {player.name} · {player.score} p</button>)}</div>
            <small>Ingen Chicago? Registrera bara resultatet nedan.</small></div>}
          <h2>Registrera givens slut</h2>
          <HandPicker title="Bästa handen vid givens slut" game={game} value={finalHand} onChange={setFinalHand} />
          <label className="irl-field">Vem vann sista sticket? · +{finalTrickPoints(game.settings)} p
            <select value={lastWinner} onChange={(event) => setLastWinner(event.target.value)}><option value="">Välj spelare</option>
              {game.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select>
          </label>
          {game.chicagoPlayerId && <div className="irl-chicago-result"><h3>Hur gick Chicago?</h3>
            <div className="irl-player-buttons"><button type="button" className={chicagoWon === true ? "selected" : ""} onClick={() => { setChicagoWon(true); setBreakerId(""); }}>Alla stick · +15</button>
              <button type="button" className={chicagoWon === false ? "selected" : ""} onClick={() => setChicagoWon(false)}>Bruten · −15</button></div>
            {chicagoWon === false && <label className="irl-field">Vem tog första sticket från Chicago-spelaren? · +10 p
              <select value={breakerId} onChange={(event) => setBreakerId(event.target.value)}><option value="">Välj spelare</option>
                {game.players.filter((player) => player.id !== game.chicagoPlayerId).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select>
            </label>}</div>}
          {resultError && <p role="alert" className="irl-error">{resultError}</p>}
          <button type="button" className="button button-primary irl-primary" onClick={finishDeal}>Räkna poäng och avsluta given <Icon name="arrow-right" /></button>
        </div>}
        {game.phase === "result" && <div className="irl-card irl-result"><h2>{matchWinner ? "Matchen är avgjord" : "Poängen är registrerade"}</h2>
          {matchWinner && <MatchPodium players={game.players} winnerId={matchWinner} />}
          <ul>{game.lastSummary.map((item, index) => <li key={index}>{item}</li>)}</ul>
          {!matchWinner && <button type="button" className="button button-primary irl-primary" onClick={nextDeal}>Nästa giv <Icon name="arrow-right" /></button>}
        </div>}
      </section>
      <aside className="irl-side"><div className="irl-scoreboard"><span>POÄNGSTÄLLNING</span>
        {game.players.map((player, index) => <div className="irl-score-row" key={player.id}><span>{index + 1}. {player.name}</span>
          <span className={`chicago-check ${player.hasDeclaredChicago ? "checked" : ""}`} role="img"
            aria-label={player.hasDeclaredChicago ? `${player.name} har sagt Chicago` : `${player.name} har inte sagt Chicago`}
            title={player.hasDeclaredChicago ? "Har sagt Chicago" : "Har inte sagt Chicago"}>{player.hasDeclaredChicago ? "✓" : ""}</span>
          <strong>{player.score}</strong></div>)}
      </div><div className="irl-tools"><button type="button" onClick={() => setGame(undoIRL(game))} disabled={!game.history.length}><Icon name="undo" /> Ångra senaste ändring</button>
        <button type="button" onClick={() => { setCorrectionId(correctionId ? null : game.players[0].id); setCorrectionReady(false); }}>Korrigera poäng</button>
        {correctionId && <div className="irl-correction"><label>Spelare<select value={correctionId} onChange={(event) => { setCorrectionId(event.target.value); setCorrectionReady(false); }}>
          {game.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>
          <label>Ny totalpoäng<input type="number" step="1" value={correctionValue} onChange={(event) => { setCorrectionValue(event.target.value); setCorrectionReady(false); }} /></label>
          {correctionReady && <p>Ändra {game.players.find((player) => player.id === correctionId)?.name} till <strong>{correctionValue} poäng</strong>?</p>}
          <button type="button" disabled={!Number.isSafeInteger(Number(correctionValue)) || correctionValue === "" || (!game.settings.allowNegativeScores && Number(correctionValue) < 0)}
            onClick={() => { if (!correctionReady) { setCorrectionReady(true); return; }
              setGame(correctIRLScore(game, correctionId, Number(correctionValue))); setCorrectionId(null); setCorrectionValue(""); setCorrectionReady(false); }}>
            {correctionReady ? "Bekräfta korrigering" : "Granska korrigering"}</button></div>}
        <button type="button" onClick={() => {
          if (!newMatchReady) { setNewMatchReady(true); return; }
          setGame(null); setNames(["", ""]); setSettings({ ...defaultSettings }); setNewMatchReady(false);
        }}>{newMatchReady ? "Bekräfta ny match (nollställ)" : "Starta ny match"}</button>
        {newMatchReady && <button type="button" onClick={() => setNewMatchReady(false)}>Avbryt</button>}
      </div><div className="irl-rules"><strong>REGLER</strong><p>Bästa handen ger 1–8 poäng efter byte 1, byte 2 och vid givens slut. Sista sticket ger {finalTrickPoints(game.settings)} poäng.</p>
        <p>{game.settings.requireOver52ToWin ? "Över 52 poäng (minst 53)" : "Minst 52 poäng"} vinner efter att spelaren minst en gång har sagt Chicago. Från 46 poäng får spelaren inte byta kort.</p>
        {game.settings.resetOver52WithoutChicago && <p>Över 52 poäng utan att ha sagt Chicago nollställer totalpoängen till 0 efter poängutdelning.</p>}
        <p>Chicago kräver minst 15 poäng och ger +15 vid alla stick, annars −15. Den som först bryter får +10.</p>
        <p>{game.settings.allowNegativeScores ? "Minuspoäng tillåts." : "Totalpoäng stannar vid 0."}</p></div></aside>
    </main>}
  </div>;
}
