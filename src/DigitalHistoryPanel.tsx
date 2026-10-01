import { useI18n } from "./LanguageProvider";
import { useAccountHistory } from "./HistoryProvider";
import { accountName } from "./account";
import { digitalStatistics } from "./digitalHistory";
import { handCategories, handCategoryName, pokerHandName } from "./poker";
import Brand from "./Brand";
import AccountControl from "./AccountControl";
import HistoryStatus from "./HistoryStatus";

export default function DigitalHistoryPanel({ onBack, onPhysical, onPlay }: { onBack: () => void; onPhysical: () => void; onPlay: () => void }) {
  const { t, locale, message } = useI18n();
  const { digitalHistory: history, digitalStore, user } = useAccountHistory();
  const stats = digitalStatistics(history.records, user ? accountName(user) : undefined);
  const number = (value: number | null) => value === null ? "—" : value.toLocaleString(locale, { maximumFractionDigits: 1 });
  const metrics = [
    [t("Spelade matcher"), number(stats.gamesPlayed)], [t("Vinster"), number(stats.wins)],
    [t("Förluster"), number(stats.losses)], [t("Vinstprocent"), number(stats.winPercentage) + " %"],
    [t("Aktuell vinstsvit"), number(stats.currentStreak)], [t("Längsta vinstsvit"), number(stats.longestStreak)],
    [t("Högsta poäng"), number(stats.bestScore)], [t("Snittpoäng"), number(stats.averageScore)],
    [t("Bästa handen"), stats.bestHand ? message(pokerHandName(stats.bestHand)) : "—"],
    [t("Royal Flush"), number(stats.royalFlushes)],
  ];
  return <div className="entry-page digital-history-page">
    <header className="inner-header page-width"><Brand /><AccountControl showHistoryStatus={false} /><button className="text-button" onClick={onBack}>{t("Huvudmeny")}</button></header>
    <main className="page-width">
      <nav className="history-nav" aria-label={t("Spelhistorik")}><button onClick={onPhysical}>{t("Fysiska matcher")}</button><button aria-current="page">{t("Digital statistik")}</button></nav>
      <h1>{t("Digital spelarstatistik")}</h1>
      <p>{t("Vinster och sviter räknas när en match är avgjord. Poäng och pokerhänder räknas från avslutade givar.")}</p>
      <HistoryStatus history={history} signedIn={!!user} onRetry={() => void digitalStore.sync()} />
      {!history.loading && history.records.length === 0 && <section className="history-empty">
        <h2>{history.error ? t("Statistiken kan inte hämtas just nu") : t("Din första match väntar")}</h2>
        <p>{history.error ? t("Du kan fortsätta spela. Det som sparats på den här enheten finns kvar.") : t("Spela med digitala kort och bygg din statistik. Du behöver inget konto för att börja.")}</p>
        <button className="button button-secondary" onClick={onPlay}>{t("Skapa spel")}</button>
      </section>}
      <dl className="digital-stats-grid">{metrics.map(([label, value]) => <div className="entry-card stat-card" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <details className="entry-card hand-statistics"><summary>{t("Pokerhänder")}</summary>
        <p>{t("En sluthand per spelare och avslutad giv. Royal Flush räknas separat från andra färgstegar.")}</p>
        <dl>{[["royal-flush", t("Royal Flush")], ...[...handCategories].reverse().map(c => [c, message(handCategoryName[c])])].map(([key, label]) =>
          <div key={key}><dt>{label}</dt><dd>{number(stats.handCounts[key])}</dd></div>)}</dl>
      </details>
      {history.records.some(r => !r.game.evaluations) && <p>{t("Äldre resultat visar bara sluthanden. Tidigare händer kan inte återskapas.")}</p>}
      {stats.unassigned > 0 && <p>{t("Vissa äldre onlineresultat saknar din spelaridentitet och kan inte räknas in säkert.")}</p>}
    </main>
  </div>;
}
