import type { SupabaseClient } from "@supabase/supabase-js";

let client: Promise<SupabaseClient | null> | undefined;

export function hasSupabaseConfiguration(): boolean {
  return !!(import.meta.env.VITE_SUPABASE_URL?.trim() && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim());
}

/** Restore accounts after the shell renders, without putting the SDK in its bundle. */
export function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (client) return client;
  if (!hasSupabaseConfiguration()) return client = Promise.resolve(null);
  client = (async () => {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      return createClient(import.meta.env.VITE_SUPABASE_URL!.trim(), import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY!.trim(), {
        auth: {
          storageKey: "chicappd-supabase-auth",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      });
    } catch {
      // Keep guest play available without exposing configuration values.
      console.warn("Supabase is unavailable. Check VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
      return null;
    }
  })();
  return client;
}

/** Public Auth settings: avoid creating mailbox-free users awaiting confirmation. */
export async function usernameSignupReady(): Promise<boolean> {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return false;
  const response = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: key },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new TypeError("Auth settings unavailable");
  const settings = await response.json();
  return settings.external?.email === true && settings.disable_signup === false && settings.mailer_autoconfirm === true;
}
