import { matchStandings } from "./scoring";

export function MatchPodium({ players, winnerId }: {
  players: readonly { id: string; name: string; score: number }[];
  winnerId: string;
}) {
  return <section className="match-podium" aria-label="Slutresultat">
    <h3>Matchen är avgjord</h3>
    <ol>{matchStandings(players, winnerId).slice(0, 3).map((player, index) =>
      <li key={player.id}>
        <span className="podium-place">{index + 1}:a</span>
        <strong>{player.name}</strong>
        <span>{player.score} p</span>
      </li>)}</ol>
  </section>;
}
