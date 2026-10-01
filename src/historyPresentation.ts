// Presentation only: never changes the queue or decides whether to retry a save.
export type HistoryStatusInput = { loading: boolean; error: string | null; records: { dirty: boolean }[] };

export function historyStatus(history: HistoryStatusInput, signedIn: boolean) {
  if (history.error?.startsWith("Kunde inte spara")) return { state: "error", text: history.error };
  if (!signedIn) return { state: "local", text: "Historik på den här enheten" };
  if (history.error) return { state: "error", text: "Kan inte uppdatera historiken just nu. Det som sparats här finns kvar." };
  if (history.loading) return { state: "loading", text: history.records.length ? "Uppdaterar historiken…" : "Hämtar historiken…" };
  if (history.records.some(r => r.dirty)) return { state: "pending", text: "Sparat här · väntar på att sparas på kontot" };
  return { state: "saved", text: history.records.length ? "Historiken är sparad på kontot" : "Historik sparas på kontot" };
}
