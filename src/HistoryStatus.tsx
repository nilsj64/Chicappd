import { useI18n } from "./LanguageProvider";
import { historyStatus } from "./historyPresentation";
import type { HistoryStatusInput } from "./historyPresentation";

export default function HistoryStatus({ history, signedIn, onRetry }: { history: HistoryStatusInput; signedIn: boolean; onRetry?: () => void }) {
  const { t, message } = useI18n();
  const status = historyStatus(history, signedIn);
  return <div className="history-status" data-state={status.state}>
    <span role="status"><span className="status-dot" aria-hidden="true" />{message(status.text)}</span>
    {signedIn && onRetry && <button className="text-button" type="button" disabled={history.loading} onClick={onRetry}>
      {history.error ? t("Försök igen") : t("Uppdatera")}
    </button>}
  </div>;
}
