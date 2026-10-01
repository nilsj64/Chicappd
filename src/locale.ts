import { english, swedish } from "./translations.ts";
import type { MessageKey } from "./translations.ts";
export type Language = "sv" | "en";
export type Translator = (key: MessageKey, values?: readonly unknown[]) => string;
export const languageStorageKey = "chicappd-language";
export const localeFor = (language: Language) => language === "sv" ? "sv-SE" : "en-GB";
export function readLanguage(storage: Pick<Storage, "getItem">): Language {
  try { return storage.getItem(languageStorageKey) === "en" ? "en" : "sv"; } catch { return "sv"; }
}
export function saveLanguage(storage: Pick<Storage, "setItem">, language: Language) {
  try { storage.setItem(languageStorageKey, language); } catch { /* Choice still works for this visit. */ }
}
export function translate(language: Language, key: MessageKey, values: readonly unknown[] = []): string {
  let copy: string = language === "en" ? english[key] : swedish[key] ?? key;
  if (language === "en") copy = copy.replace(/\{(\d+)\} (cards|points)\b/g, (phrase, index: string, noun: string) =>
    values[Number(index)] === 1 ? `{${index}} ${noun.slice(0, -1)}` : phrase);
  return copy.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? ""));
}
const known = (value: string): value is MessageKey => Object.hasOwn(english, value);
// Legacy summaries and Worker replies contain canonical Swedish messages. Match
// complete known formats at the display boundary; never rewrite stored payloads,
// room events, or user-entered player names. Only declared terminology is translated.
const legacy: { source: MessageKey; terms?: number[] }[] = [
  { source: "Ogiltigt användarnamn. {0}", terms: [0] },
  { source: "Kontot är klart. Välkommen, {0}." },
  { source: "Du är inloggad. Välkommen, {0}." },
  { source: "Byte {0}: {1} hade bästa hand ({2}) och fick {3} poäng", terms: [2] },
  { source: "Sluthand: {0} hade bästa hand ({1}) och fick {2} poäng", terms: [1] },
  { source: "Sista sticket: {0} +{1} enligt regeln för sista sticket" },
  { source: "Bröt Chicago: {0} +{1}" },
  { source: "Bröt Chicago: {0}" },
  { source: "Korrigering: {0} till {1}" },
  { source: "{0} hade bästa hand ({1}) och fick {2} poäng efter byte {3}", terms: [1] },
  { source: "{0} hade bästa hand ({1}) och fick {2} poäng vid rundans slut", terms: [1] },
  { source: "Ingen fick poäng för handen efter byte {0}" },
  { source: "Byte {0}: {1} byter {2} kort" },
  { source: "Byte {0}: {1} behåller handen" },
  { source: "Byte {0}: {1} tog det presenterade kortet" },
  { source: "Byte {0}: {1} avstod från det presenterade kortet och fick ett nytt kort" },
  { source: "Du måste följa {0}. Välj ett kort i den färgen.", terms: [0] },
  { source: "{0} säger Chicago – måste vinna alla stick" },
  { source: "{0} bröt Chicago (+{1} p)" },
  { source: "{0} bröt Chicago" },
  { source: "{0} vann sista sticket (+{1} p enligt regeln för sista sticket)" },
  { source: "{0} vann Chicago (+{1} p)" },
  { source: "{0} förlorade Chicago ({1} p)" },
  { source: "{0} vann stick {1}" },
  { source: "{0} spelar {1} i {2}", terms: [2] },
  { source: "{0} · {1} som {2}", terms: [0, 1, 2] },
  ...(["Färgstege – {0} högst", "Fyrtal – {0}", "Kåk – {0} över {1}", "Färg – {0} högst", "Stege – {0} högst", "Triss – {0}", "Två par – {0} och {1}", "Ett par – {0}", "Högt kort – {0}"] as const).map(source => ({source, terms:[0,1]})),
];
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = legacy.map(entry => ({...entry, regex: new RegExp("^" + entry.source.split(/\{\d+\}/).map(escape).join("(.*?)") + "$", "u")}));
const highRanks: Record<string, string> = { "tvåor": "two", "treor": "three", "fyror": "four", "femmor": "five", "sexor": "six", "sjuor": "seven", "åttor": "eight", "nior": "nine", "tior": "ten", "knektar": "jack", "damer": "queen", "kungar": "king", "ess": "ace" };
export function localizeMessage(language: Language, value: string): string {
  if (known(value)) return translate(language, value);
  for (const entry of patterns) {
    const match = entry.regex.exec(value);
    if (!match) continue;
    const values = match.slice(1).map((text, index) => {
      if (/^\d+$/.test(text) && (entry.source.includes(`{${index}} poäng`) ||
        entry.source.includes(`{${index}} kort`))) return Number(text);
      if (!entry.terms?.includes(index)) return text;
      if (language === "en" && (entry.source.includes("högst") || entry.source.startsWith("Högt kort")) && highRanks[text]) return highRanks[text];
      if (language === "en" && text === "ess" && /^(Fyrtal|Kåk|Triss|Två par|Ett par)/.test(entry.source)) return "aces";
      return localizeMessage(language, text);
    });
    return translate(language, entry.source, values);
  }
  return value; // Names, room codes, card symbols and unknown user content stay intact.
}
export function localizedError(language: Language, value: string): string {
  return known(value) || patterns.some(p => p.regex.test(value)) ? localizeMessage(language, value) : translate(language, "Något gick fel.");
}
