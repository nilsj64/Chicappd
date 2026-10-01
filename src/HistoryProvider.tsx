import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseClient, hasSupabaseConfiguration } from "./supabase";
import { HistoryStore, supabaseHistoryRemote } from "./history";
import { digitalHistoryOptions } from "./digitalHistory";
import type { DigitalHistory } from "./digitalHistory";

function useHistoryAccount() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [store] = useState(() => new HistoryStore(localStorage));
  const remote = useMemo(() => client ? supabaseHistoryRemote(client) : null, [client]);
  const [digitalStore] = useState(() => new HistoryStore<DigitalHistory>(localStorage, undefined, undefined, digitalHistoryOptions));
  const digitalRemote = useMemo(() => client ? supabaseHistoryRemote(client, digitalHistoryOptions) : null, [client]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(hasSupabaseConfiguration);
  const history = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const digitalHistory = useSyncExternalStore(digitalStore.subscribe, digitalStore.getSnapshot);
  useEffect(() => {
    let active = true;
    void getSupabaseClient().then(next => {
      if (!active) return;
      setClient(next);
      if (!next) setLoading(false);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, [client]);
  useEffect(() => { store.setOwner(user?.id ?? null, remote); }, [store, remote, user?.id]);
  useEffect(() => { digitalStore.setOwner(user?.id ?? null, digitalRemote); }, [digitalStore, digitalRemote, user?.id]);
  useEffect(() => {
    const retry = () => { if (document.visibilityState === "visible") { void store.sync(); void digitalStore.sync(); } };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [store, digitalStore]);
  // Never expose a previous account's state between auth event and effect.
  const aligned = history.ownerId === (user?.id ?? null);
  const digitalAligned = digitalHistory.ownerId === (user?.id ?? null);
  return { client, user, loading, store, digitalStore,
    digitalHistory: digitalAligned ? digitalHistory : { ...digitalHistory, records: [], selectedId: null, loading: true },
    history: aligned ? history : { ...history, records: [], selectedId: null, loading: true } };
}
type AccountHistory = ReturnType<typeof useHistoryAccount>;
const Context = createContext<AccountHistory | null>(null);

export function HistoryProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={useHistoryAccount()}>{children}</Context.Provider>;
}

export function useAccountHistory() {
  const value = useContext(Context);
  if (!value) throw new Error("HistoryProvider is required");
  return value;
}
