import { lazy, Suspense, useState, useTransition } from "react";
import Landing from "./Landing";
import Brand from "./Brand";
import { useI18n } from "./LanguageProvider";
import { API_URL, savedSession, saveSession } from "./online";

const DigitalGame = lazy(() => import("./DigitalGame"));
const IRLTable = lazy(() => import("./IRLTable"));
const DigitalHistoryPanel = lazy(() => import("./DigitalHistoryPanel"));
type View = "landing" | "physical" | "history" | "create" | "join" | "resume";

function LoadingView({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  return <div className="entry-page">
    <header className="page-width inner-header"><Brand /></header>
    <main className="page-width entry-layout"><div className="entry-card">
      <p className="irl-sync-loading" role="status">{t("Ett ögonblick…")}</p>
      <button className="button button-secondary" onClick={onBack}>{t("Till startsidan")}</button>
    </div></main>
  </div>;
}

export default function App() {
  const { t } = useI18n();
  const [view, setView] = useState<View>(() => API_URL && savedSession() ? "resume" : "landing");
  const [pending, startTransition] = useTransition();
  const navigate = (next: View) => startTransition(() => setView(next));
  const back = () => {
    if (view === "resume") saveSession(null);
    navigate("landing");
  };
  // Keep the current view interactive while a new feature downloads. The existing
  // status treatment overlays it, so loading adds no shift to the page layout.
  return <><Suspense fallback={<LoadingView onBack={back} />}>
    {view === "landing" ? <Landing onEnter={mode => navigate(mode ?? "landing")}
      onPhysical={() => navigate("physical")} onHistory={() => navigate("history")} />
      : view === "physical" ? <IRLTable onExit={back} onDigital={() => navigate("history")} />
      : view === "history" ? <DigitalHistoryPanel onBack={back} onPhysical={() => navigate("physical")}
        onPlay={() => navigate("create")} />
      : <DigitalGame initialMode={view === "resume" ? null : view} onExit={back} />}
  </Suspense>{pending && <div className="network-message" role="status">{t("Ett ögonblick…")}</div>}</>;
}
