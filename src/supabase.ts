import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

/** Optional account services can use this client; guest play never requires it. */
export function getSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  client = null;
  if (!url || !key) return client;

  try {
    client = createClient(url, key, {
      auth: {
        storageKey: "chicappd-supabase-auth",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  } catch {
    // A bad local configuration must not prevent guest play or expose key values.
    console.warn("Supabase is unavailable. Check VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.");
  }
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
