import { useI18n } from "./LanguageProvider";
import { useAccountHistory } from "./HistoryProvider";
import Brand from "./Brand";
import AccountControl from "./AccountControl";
import HistoryStatus from "./HistoryStatus";

export default function DigitalHistoryPanel({ onBack, onPhysical, onPlay }: { onBack: () => void; onPhysical: () => void; onPlay: () => void }) {
  const { t, locale } = useI18n();
  const { digitalHistory: history, digitalStore, user } = useAccountHistory();
  return <div className="entry-page digital-history-page">
    <header className="inner-header page-width"><Brand /><AccountControl showHistoryStatus={false} /><button className="text-button" onClick={onBack}>{t("Huvudmeny")}</button></header>
    <main className="page-width">
      <nav className="history-nav" aria-label={t("Spelhistorik")}><button onClick={onPhysical}>{t("Fysiska matcher")}</button><button aria-current="page">{t("Digitala givar")}</button></nav>
      <h1>{t("Digital spelhistorik")}</h1>
      <p>{t("Resultat från avslutade givar med digitala kort. Pågående spel visas inte här.")}</p>
      <HistoryStatus history={history} signedIn={!!user} onRetry={() => void digitalStore.sync()} />
      {!history.loading && history.records.length === 0 && <section className="history-empty">
        <h2>{history.error ? t("Historiken kan inte hämtas just nu") : t("Din första giv väntar")}</h2>
        <p>{history.error ? t("Du kan fortsätta spela. Det som sparats på den här enheten finns kvar.") : t("Spela en digital giv så visas resultatet här. Du behöver inget konto för att börja.")}</p>
        <button className="button button-secondary" onClick={onPlay}>{t("Skapa spel")}</button>
      </section>}
      <div className="digital-history-list">{[...history.records].sort((a,b) => b.updated_at.localeCompare(a.updated_at)).map(record => <article className="entry-card" key={record.id}>
        <span className="form-kicker">{record.game.source === "online" ? t("ONLINESPEL") : t("LOKALT SPEL")} · {t("RUM")} {record.game.roomCode}</span>
        <h2>{record.game.players.map(p => p.name).join(" · ")}</h2>
        <p className="history-date"><time dateTime={record.updated_at}>{new Date(record.updated_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}</time>{user && record.dirty ? t(" · Sparat här, väntar på kontot") : ""}</p>
        <ul className="history-scores">{record.game.players.map(p => <li key={p.id}><span>{p.name}{p.hasDeclaredChicago && <small>{t("Chicago ✓")}</small>}</span><strong>{p.score} {" "}{t("p")}</strong></li>)}</ul>
        {record.game.history[0].finalTrickAward && <p>{t("Sista sticket:")}{" "}{record.game.players.find(p => p.id === record.game.history[0].finalTrickAward?.winnerId)?.name} +{record.game.history[0].finalTrickAward.points} {" "}{t("p")}</p>}
      </article>)}</div>
    </main>
  </div>;
}
