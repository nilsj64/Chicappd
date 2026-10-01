import { useI18n } from "./LanguageProvider";
import { matchStandings } from "./scoring";

export function MatchPodium({ players, winnerId }: {
  players: readonly { id: string; name: string; score: number }[];
  winnerId: string;
}) {
  const { t } = useI18n();
  return <section className="match-podium" aria-label={t("Slutresultat")}>
    <h3>{t("Matchen är avgjord")}</h3>
    <ol>{matchStandings(players, winnerId).slice(0, 3).map((player, index) =>
      <li key={player.id}>
        <span className="podium-place">{t("{0}:a", [index + 1])}</span>
        <strong>{player.name}</strong>
        <span>{player.score} {" "}{t("p")}</span>
      </li>)}</ol>
  </section>;
}
