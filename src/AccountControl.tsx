import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { usernameSignupReady } from "./supabase";
import { useAccountHistory } from "./HistoryProvider";
import { accountCredentials, accountError, accountName, authenticateAccount, usernameHelp } from "./account";
import HistoryStatus from "./HistoryStatus";

export default function AccountControl({ showHistoryStatus = true }: { showHistoryStatus?: boolean }) {
  const { client, user, loading, history, store, digitalHistory, digitalStore } = useAccountHistory();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const usernameInput = useRef<HTMLInputElement>(null);
  const errors = [history.error, digitalHistory.error];
  const combinedHistory = { records: [...history.records, ...digitalHistory.records],
    loading: loading || history.loading || digitalHistory.loading, error: errors.find(e => e?.startsWith("Kunde inte spara")) || history.error || digitalHistory.error };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!client || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      accountCredentials(mode, username, password);
      if (mode === "signup" && !await usernameSignupReady()) {
        throw new Error("Kontotjänsten är inte redo för nya konton. Du kan fortsätta spela som gäst.");
      }
      const session = await authenticateAccount(client, mode, username, password);
      setNotice(`${mode === "signup" ? "Kontot är klart." : "Du är inloggad."} Välkommen, ${accountName(session.user)}.`);
      dialog.current?.close();
      setUsername("");
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "Error" ? cause.message : accountError(cause));
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  async function signOut() {
    if (!client || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { error: cause } = await client.auth.signOut({ scope: "local" });
      if (cause) setError(accountError(cause));
      else setNotice("Du är utloggad. Historiken på kontot finns kvar.");
    } catch (cause) { setError(accountError(cause)); }
    finally { setBusy(false); }
  }

  return <div className="account-control">
    <div className="account-actions">
    {user ? <>
      <span className="account-name" title={`Inloggad som ${accountName(user)}`}>{accountName(user)}<small>Inloggad</small></span>
      <button className="text-button" disabled={busy} onClick={() => void signOut()}>{busy ? "Loggar ut…" : "Logga ut"}</button>
    </> : <><span className="account-name">{loading ? "Ett ögonblick…" : "Gäst"}</span><button className="text-button" disabled={loading} onClick={() => { setError(""); setNotice(""); setOpen(true); dialog.current?.showModal(); usernameInput.current?.focus(); }}>
      Logga in
    </button></>}
    </div>
    {showHistoryStatus && <HistoryStatus history={combinedHistory} signedIn={!!user}
      onRetry={combinedHistory.error || combinedHistory.records.some(r => r.dirty) ? () => { void store.sync(); void digitalStore.sync(); } : undefined} />}
    {notice && <p className="account-notice" role="status">{notice}</p>}
    {error && !open && <p className="account-error" role="alert">{error}</p>}
    <dialog ref={dialog} className="account-dialog entry-card" aria-labelledby="account-title" aria-describedby="account-intro" onClose={() => { setPassword(""); setError(""); setOpen(false); }}>
      <button className="text-button account-close" aria-label="Stäng kontofönstret" onClick={() => dialog.current?.close()}>Stäng</button>
      <span className="form-kicker">VALFRITT KONTO</span>
      <h2 id="account-title">{mode === "signup" ? "Skapa konto" : "Logga in"}</h2>
      <p id="account-intro">{mode === "signup" ? "Spara din spelhistorik och ta med den till andra enheter. Ingen e-post behövs." : "Logga in för att hämta din sparade spelhistorik."}</p>
      {!client ? <p role="status">Konton är inte tillgängliga just nu. Fortsätt gärna spela som gäst.</p> : <form onSubmit={(event) => void submit(event)} aria-busy={busy}>
        <label htmlFor="account-username">Användarnamn</label>
        <input ref={usernameInput} id="account-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
          aria-describedby={mode === "signup" ? "username-help" : undefined} autoFocus required value={username} disabled={busy} onChange={(event) => setUsername(event.target.value)} />
        {mode === "signup" && <p id="username-help" className="account-help">{usernameHelp}</p>}
        <label htmlFor="account-password">Lösenord</label>
        <input id="account-password" name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"}
          aria-describedby={mode === "signup" ? "password-help" : undefined} required value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} />
        {mode === "signup" && <p id="password-help" className="account-help">Minst 8 tecken. Spara ditt lösenord – det går inte att återställa det.</p>}
        {error && <p className="account-error" role="alert">{error}</p>}
        <button className="button button-primary" disabled={busy}>{busy ? mode === "signup" ? "Skapar konto…" : "Loggar in…" : mode === "signup" ? "Skapa konto" : "Logga in"}</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin"); setError(""); setPassword("");
        }}>{mode === "signin" ? "Nytt här? Skapa konto" : "Har du redan konto? Logga in"}</button>
      </form>}
      <div className="account-guest-option"><p>Konto är valfritt. Du kan alltid spela som gäst.</p><button className="text-button" onClick={() => dialog.current?.close()}>Fortsätt som gäst</button></div>
    </dialog>
  </div>;
}
