import type { SupabaseClient, User } from "@supabase/supabase-js";

// Reserved, non-deliverable namespace. Never display this as the user's email.
const identityDomain = "accounts.chicappd.invalid";
export const usernameHelp = "3–24 tecken: a–z, 0–9 och understreck. Börja med en bokstav eller siffra. Stora och små bokstäver räknas som samma namn.";

export function canonicalUsername(input: string): string {
  // Validate ASCII before lowercasing to avoid Unicode lookalike/case collisions.
  const name = input.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_]{2,23}$/.test(name)) {
    throw new Error(`Ogiltigt användarnamn. ${usernameHelp}`);
  }
  return name.toLowerCase();
}

export function accountIdentifier(username: string): string {
  return `${canonicalUsername(username)}@${identityDomain}`;
}

export function accountName(user: User): string {
  const suffix = `@${identityDomain}`;
  if (user.email?.endsWith(suffix)) {
    const name = user.email.slice(0, -suffix.length);
    if (/^[a-z0-9][a-z0-9_]{2,23}$/.test(name)) return name;
  }
  return "Ditt konto";
}

export function accountError(error: unknown): string {
  const cause = error as { code?: string; name?: string; status?: number } | null;
  if (["AuthRetryableFetchError", "TimeoutError", "AbortError"].includes(cause?.name ?? "") || error instanceof TypeError || (cause?.status ?? 0) >= 500) {
    return "Kunde inte nå kontotjänsten. Kontrollera anslutningen och försök igen.";
  }
  switch (cause?.code) {
    case "invalid_credentials": return "Fel användarnamn eller lösenord.";
    case "user_already_exists":
    case "email_exists": return "Användarnamnet är redan upptaget. Välj ett annat eller logga in.";
    case "weak_password": return "Lösenordet är för svagt. Använd ett längre lösenord med både bokstäver, siffror och symboler.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit": return "För många försök. Vänta en stund och försök igen.";
    case "email_not_confirmed":
    case "email_address_invalid":
    case "email_address_not_authorized":
    case "email_provider_disabled":
    case "signup_disabled": return "Kontotjänsten är inte redo för nya konton. Du kan fortsätta spela som gäst.";
    default: return "Det gick inte att slutföra kontoärendet. Försök igen om en stund.";
  }
}

export function accountCredentials(mode: "signup" | "signin", username: string, password: string) {
  const email = accountIdentifier(username);
  if (!password) throw new Error("Ange ditt lösenord.");
  if (mode === "signup" && password.length < 8) throw new Error("Lösenordet måste innehålla minst 8 tecken.");
  return { email, password };
}

export async function authenticateAccount(client: SupabaseClient, mode: "signup" | "signin", username: string, password: string) {
  const credentials = accountCredentials(mode, username, password);
  const result = await (mode === "signup"
    ? client.auth.signUp(credentials)
    : client.auth.signInWithPassword(credentials))
    .catch((cause: unknown) => { throw new Error(accountError(cause)); });
  const { data, error } = result;
  if (error) throw new Error(accountError(error));
  if (!data.session) throw new Error("Kontotjänsten är inte redo för inloggning. Du kan fortsätta spela som gäst.");
  return data.session;
}
