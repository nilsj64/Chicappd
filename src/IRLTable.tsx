import { useI18n } from "./LanguageProvider";
import { useState } from "react";
import type { GameSettings } from "./game";
import { handCategories, handCategoryPoints } from "./poker";
import type { HandCategory } from "./poker";
import { canDeclareChicago, defaultSettings, finalTrickPoints, matchWinnerId } from "./scoring";
import { correctIRLScore, createIRLGame, declareIRLChicago, finishIRLDeal, nextIRLDeal, recordFirstHands, undoIRL } from "./irl";
import type { HandResult, IRLGame } from "./irl";
import Brand, { BrandMark } from "./Brand";
import { MatchPodium } from "./MatchPodium";
import { Icon, SuitIcon } from "./Icon";
import { useAccountHistory } from "./HistoryProvider";
import AccountControl from "./AccountControl";
import HistoryStatus from "./HistoryStatus";

const categories: Record<HandCategory, string> = {
  "high-card": "Högt kort", "one-pair": "Par", "two-pair": "Två par", "three-of-a-kind": "Triss",
  straight: "Stege", flush: "Färg", "full-house": "Kåk", "four-of-a-kind": "Fyrtal", "straight-flush": "Färgstege",
};

function RuleSettings({ settings, onChange }: { settings: GameSettings; onChange: (settings: GameSettings) => void }) {
  const { t } = useI18n();
  return <div className="irl-settings">
    <label>{t("Sista sticket")}<select value={settings.finalTrickPoints} onChange={(event) => onChange({ ...settings, finalTrickPoints: Number(event.target.value) as 2 | 5 })}>
        <option value={5}>{t("5 poäng")}</option><option value={2}>{t("2 poäng")}</option>
      </select>
    </label>
    <label>{t("Chicago krävs för vinst")}<select value={(settings.chicagoRequiredToWin ?? true) ? "yes" : "no"} onChange={(event) => onChange({ ...settings, chicagoRequiredToWin: event.target.value === "yes" })}>
        <option value="yes">{t("På")}</option><option value="no">{t("Av")}</option>
      </select>
    </label>
    <label>{t("Minuspoäng")}<select value={settings.allowNegativeScores ? "yes" : "no"} onChange={(event) => onChange({ ...settings, allowNegativeScores: event.target.value === "yes" })}>
        <option value="no">{t("Tillåt inte minuspoäng")}</option><option value="yes">{t("Tillåt minuspoäng")}</option>
      </select>
    </label>
    <label>{t("Första som bryter Chicago får 10 poäng")}<select value={settings.firstChicagoBreakBonus ? "yes" : "no"} onChange={(event) => onChange({ ...settings, firstChicagoBreakBonus: event.target.value === "yes" })}>
        <option value="no">{t("Av")}</option><option value="yes">{t("På")}</option>
      </select>
    </label>
    <label>{t("Nollställ vid över 52 poäng utan Chicago")}<select value={settings.resetOver52WithoutChicago ? "yes" : "no"} onChange={(event) => onChange({ ...settings, resetOver52WithoutChicago: event.target.value === "yes" })}>
        <option value="no">{t("Av · behåll poängen")}</option><option value="yes">{t("På · nollställ till 0")}</option>
      </select>
    </label>
  </div>;
}

function HandPicker({ title, game, value, onChange }: { title: string; game: IRLGame; value: HandResult; onChange: (value: HandResult) => void }) {
  const { t, message } = useI18n();
  return <fieldset className="irl-hand-picker">
    <legend>{title}</legend>
    <label>{t("Vem hade bästa handen?")}<select value={value?.playerId ?? ""} onChange={(event) => onChange(event.target.value
        ? { playerId: event.target.value, category: value?.category ?? "one-pair" } : null)}>
        <option value="">{t("Ingen poäng / lika")}</option>
        {game.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
      </select>
    </label>
    {value && <label>{t("Handens värde")}<select value={value.category} onChange={(event) => onChange({ ...value, category: event.target.value as HandCategory })}>
        {handCategories.filter((category) => handCategoryPoints(category) > 0).map((category) =>
          <option key={category} value={category}>{message(categories[category])} · +{handCategoryPoints(category)}</option>)}
      </select>
    </label>}
  </fieldset>;
}

export default function IRLTable({ onExit, onDigital }: { onExit: () => void; onDigital: () => void }) {
  const { user, history } = useAccountHistory();
  return <IRLMatch key={`${user?.id ?? "guest"}:${history.selectedId ?? "new"}`} onExit={onExit} onDigital={onDigital} />;
}

function IRLMatch({ onExit, onDigital }: { onExit: () => void; onDigital: () => void }) {
  const { t, message, errorMessage, locale } = useI18n();
  const { history, store, user, loading: accountLoading } = useAccountHistory();
  const game = history.records.find(r => r.id === history.selectedId)?.game ?? null;
  const setGame = store.setGame;
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

  function startMatch() {
    const created = createIRLGame(names, settings);
    if (!created) { setSetupError("Ange 2–6 olika spelarnamn, högst 20 tecken vardera."); return; }
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
      <span>{t("FYSISKA KORT · POÄNGRÄKNARE")}</span>
      <button type="button" onClick={onExit}><Icon name="arrow-left" /> {" "}{t("Huvudmeny")}</button>
      {game && <div className="irl-mobile-score">{game.players.map((player) => <span key={player.id}>{player.name} <strong>{player.score}</strong></span>)}</div>}
    </header>
    <section className="irl-history-bar" aria-label={t("Fysiska matcher och historik")}>
      <nav className="history-nav" aria-label={t("Spelhistorik")}><button aria-current="page">{t("Fysiska matcher")}</button><button onClick={onDigital}>{t("Digitala givar")}</button></nav>
      <AccountControl showHistoryStatus={false} />
      <HistoryStatus history={history} signedIn={!!user} onRetry={() => void store.sync()} />
      {user && history.records.length > 0 && <label>{t("Sparad fysisk match")}{" "}<select value={history.selectedId ?? ""} disabled={history.loading}
        onChange={(event) => store.select(event.target.value)}>
        <option value="" disabled>{t("Välj match")}</option>
        {[...history.records].sort((a,b) => b.updated_at.localeCompare(a.updated_at)).map(record => <option key={record.id} value={record.id}>
          {record.game.players.map(p => p.name).join(" · ")} — {t("giv")} {record.game.dealNumber} · {new Date(record.updated_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
        </option>)}
      </select></label>}
    </section>
    {(accountLoading || (history.loading && !game)) ? <p className="irl-sync-loading" role="status">{t("Hämtar sparad match…")}</p> : <>
    {!game ? <main className="irl-setup">
      <div className="eyebrow"><span className="suit-row"><SuitIcon suit="spades" /><SuitIcon suit="hearts" />
        <SuitIcon suit="diamonds" /><SuitIcon suit="clubs" /></span> {" "}{t("SAMMA REGLER, RIKTIGA KORT")}</div>
      <h1>{t("Samla spelarna")}{" "}<em>{t("runt bordet.")}</em></h1>
      <p>{t("Ta fram en kortlek. Appen håller poängen medan ni spelar.")}</p>
      <p className="history-explainer">{user ? history.records.length ? t("Starta en ny match eller välj en sparad match ovan. Varje match sparas på ditt konto.") : t("Din första match börjar här. Poängen sparas på ditt konto medan ni spelar.") : t("Din senaste match sparas på den här enheten. Logga in om du vill spara flera matcher och fortsätta på andra enheter.")}</p>
      <section className="irl-card">
        <h2>{t("Vilka spelar?")}</h2>
        <div className="irl-name-list">{names.map((name, index) => <label key={index}>{t("Spelare")}{" "}{index + 1}
          <input value={name} maxLength={20} placeholder={t("Namn {0}", [index + 1])} onChange={(event) =>
            setNames((current) => current.map((item, position) => position === index ? event.target.value : item))} />
        </label>)}</div>
        <div className="irl-inline-actions">
          <button type="button" onClick={() => setNames((current) => [...current, ""])} disabled={names.length >= 6}><Icon name="plus" /> {" "}{t("Lägg till spelare")}</button>
          <button type="button" onClick={() => setNames((current) => current.slice(0, -1))} disabled={names.length <= 2}>{t("Ta bort sista")}</button>
        </div>
        <h2>{t("Regler")}</h2>
        <RuleSettings settings={settings} onChange={setSettings} />
        {setupError && <p role="alert" className="irl-error">{errorMessage(setupError)}</p>}
        <button type="button" className="button button-primary irl-primary" onClick={startMatch}>{t("Starta match")}{" "}<Icon name="arrow-right" /></button>
      </section>
    </main> : <main className="irl-layout">
      <section className="irl-main">
        <div className="irl-round-heading"><span>{t("GIV")}{" "}{game.dealNumber}</span><h1>{game.phase === "hands" ? t("Registrera händerna") : game.phase === "tricks" ? t("Stickspelet") : t("Given är klar")}</h1>
          <p>{t("Givare:")}{" "}{game.players[(game.dealNumber - 1) % game.players.length].name}</p></div>
        {game.chicagoPlayerId && <div className="irl-chicago-active" role="status"><BrandMark /> CHICAGO · {game.players.find((p) => p.id === game.chicagoPlayerId)?.name} {" "}{t("ska ta alla stick")}</div>}
        {game.phase === "hands" && <div className="irl-card">
          <p>{t("Efter varje av de två första bytena: välj spelaren med bäst poänggivande hand och handens kategori. Vid lika bästa hand får ingen poäng. Från 46 poäng får spelaren inte byta fysiska kort.")}</p>
          <HandPicker title={t("Efter byte 1")} game={game} value={firstHands[0]} onChange={(value) => setFirstHands([value, firstHands[1]])} />
          <HandPicker title={t("Efter byte 2")} game={game} value={firstHands[1]} onChange={(value) => setFirstHands([firstHands[0], value])} />
          <button type="button" className="button button-primary irl-primary" onClick={() => setGame(recordFirstHands(game, firstHands))}>{t("Starta stickspelet")}{" "}<Icon name="arrow-right" /></button>
        </div>}
        {game.phase === "tricks" && <div className="irl-card">
          {!game.chicagoPlayerId && <div className="irl-chicago-choice"><h2>{t("Chicago?")}</h2><p>{t("Kan sägas före första sticket av en spelare med minst 15 poäng.")}</p>
            <div className="irl-player-buttons">{game.players.map((player) => <button type="button" key={player.id}
              disabled={!canDeclareChicago(player.score)} onClick={() => setGame(declareIRLChicago(game, player.id))}>
              {player.name} · {player.score} {" "}{t("p")}</button>)}</div>
            <small>{t("Ingen Chicago? Registrera bara resultatet nedan.")}</small></div>}
          <h2>{t("Registrera givens slut")}</h2>
          <HandPicker title={t("Bästa handen vid givens slut")} game={game} value={finalHand} onChange={setFinalHand} />
          <label className="irl-field">{t("Vem vann sista sticket? · +")}{finalTrickPoints(game.settings)} {" "}{t("p")}<select value={lastWinner} onChange={(event) => setLastWinner(event.target.value)}><option value="">{t("Välj spelare")}</option>
              {game.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select>
          </label>
          {game.chicagoPlayerId && <div className="irl-chicago-result"><h3>{t("Hur gick Chicago?")}</h3>
            <div className="irl-player-buttons"><button type="button" className={chicagoWon === true ? "selected" : ""} onClick={() => { setChicagoWon(true); setBreakerId(""); }}>{t("Alla stick · +15")}</button>
              <button type="button" className={chicagoWon === false ? "selected" : ""} onClick={() => setChicagoWon(false)}>{t("Bruten · −15")}</button></div>
            {chicagoWon === false && <label className="irl-field">{t("Vem tog första sticket från Chicago-spelaren?")}<select value={breakerId} onChange={(event) => setBreakerId(event.target.value)}><option value="">{t("Välj spelare")}</option>
                {game.players.filter((player) => player.id !== game.chicagoPlayerId).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select>
            </label>}</div>}
          {resultError && <p role="alert" className="irl-error">{errorMessage(resultError)}</p>}
          <button type="button" className="button button-primary irl-primary" onClick={finishDeal}>{t("Räkna poäng och avsluta given")}{" "}<Icon name="arrow-right" /></button>
        </div>}
        {game.phase === "result" && <div className="irl-card irl-result"><h2>{matchWinner ? t("Matchen är avgjord") : t("Poängen är registrerade")}</h2>
          {matchWinner && <MatchPodium players={game.players} winnerId={matchWinner} />}
          <ul>{game.lastSummary.map((item, index) => <li key={index}>{message(item)}</li>)}</ul>
          {!matchWinner && <button type="button" className="button button-primary irl-primary" onClick={nextDeal}>{t("Nästa giv")}{" "}<Icon name="arrow-right" /></button>}
        </div>}
      </section>
      <aside className="irl-side"><div className="irl-scoreboard"><span>{t("POÄNGSTÄLLNING")}</span>
        {game.players.map((player, index) => <div className="irl-score-row" key={player.id}><span>{index + 1}. {player.name}</span>
          {(game.settings.chicagoRequiredToWin ?? true) && <span className={`chicago-check ${player.hasDeclaredChicago ? "checked" : ""}`} role="img"
            aria-label={player.hasDeclaredChicago ? t("{0} har sagt Chicago", [player.name]) : t("{0} har inte sagt Chicago", [player.name])}
            title={player.hasDeclaredChicago ? t("Har sagt Chicago") : t("Har inte sagt Chicago")}>{player.hasDeclaredChicago ? "✓" : ""}</span>}
          <strong>{player.score}</strong></div>)}
      </div><div className="irl-tools"><button type="button" onClick={() => setGame(undoIRL(game))} disabled={!game.history.length}><Icon name="undo" /> {" "}{t("Ångra senaste ändring")}</button>
        <button type="button" onClick={() => { setCorrectionId(correctionId ? null : game.players[0].id); setCorrectionReady(false); }}>{t("Korrigera poäng")}</button>
        {correctionId && <div className="irl-correction"><label>{t("Spelare")}<select value={correctionId} onChange={(event) => { setCorrectionId(event.target.value); setCorrectionReady(false); }}>
          {game.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>
          <label>{t("Ny totalpoäng")}<input type="number" step="1" value={correctionValue} onChange={(event) => { setCorrectionValue(event.target.value); setCorrectionReady(false); }} /></label>
          {correctionReady && <p>{t("Ändra")}{" "}{game.players.find((player) => player.id === correctionId)?.name} {t("till")} <strong>{correctionValue} {" "}{t("poäng")}</strong>?</p>}
          <button type="button" disabled={!Number.isSafeInteger(Number(correctionValue)) || correctionValue === "" || (!game.settings.allowNegativeScores && Number(correctionValue) < 0)}
            onClick={() => { if (!correctionReady) { setCorrectionReady(true); return; }
              setGame(correctIRLScore(game, correctionId, Number(correctionValue))); setCorrectionId(null); setCorrectionValue(""); setCorrectionReady(false); }}>
            {correctionReady ? t("Bekräfta korrigering") : t("Granska korrigering")}</button></div>}
        <button type="button" onClick={() => {
          if (!newMatchReady) { setNewMatchReady(true); return; }
          setGame(null); setNames(["", ""]); setSettings({ ...defaultSettings }); setNewMatchReady(false);
        }}>{newMatchReady ? t("Bekräfta ny match (nollställ)") : t("Starta ny match")}</button>
        {newMatchReady && <button type="button" onClick={() => setNewMatchReady(false)}>{t("Avbryt")}</button>}
      </div><div className="irl-rules"><strong>{t("REGLER")}</strong><p>{t("Bästa handen ger 1–8 poäng efter byte 1, byte 2 och vid givens slut. Sista sticket ger")}{" "}{finalTrickPoints(game.settings)} {" "}{t("poäng.")}</p>
        <p>{t("Över 52 poäng krävs för vinst (minst 53).")} {" "}{(game.settings.chicagoRequiredToWin ?? true) && <>{t("Du måste ha sagt Chicago minst en gång för att vinna.")}{" "}</>}{t("Från 46 poäng är kortbyte spärrat. Sista sticket ger också poäng.")}</p>
        {game.settings.resetOver52WithoutChicago && <p>{t("Över 52 poäng utan att ha sagt Chicago nollställer totalpoängen till 0 efter poängutdelning.")}</p>}
        <p>{t("Chicago kräver minst 15 poäng och ger +15 vid alla stick, annars −15.")}</p>
        {game.settings.firstChicagoBreakBonus && <p>{t("Första som bryter Chicago får 10 poäng")}{" · "}{t("En gång per spel.")}</p>}
        <p>{game.settings.allowNegativeScores ? t("Minuspoäng tillåts.") : t("Totalpoäng stannar vid 0.")}</p></div></aside>
    </main>}
    </>}
  </div>;
}
