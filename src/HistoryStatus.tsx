import { historyStatus } from "./historyPresentation";
import type { HistoryStatusInput } from "./historyPresentation";

export default function HistoryStatus({ history, signedIn, onRetry }: { history: HistoryStatusInput; signedIn: boolean; onRetry?: () => void }) {
  const status = historyStatus(history, signedIn);
  return <div className="history-status" data-state={status.state}>
    <span role="status"><span className="status-dot" aria-hidden="true" />{status.text}</span>
    {signedIn && onRetry && <button className="text-button" type="button" disabled={history.loading} onClick={onRetry}>
      {history.error ? "Försök igen" : "Uppdatera"}
    </button>}
  </div>;
}
