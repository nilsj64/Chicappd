import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { localeFor, localizeMessage, localizedError, readLanguage, saveLanguage, translate } from "./locale";
import type { Language, Translator } from "./locale";

function languageStorage() {
  try { return localStorage; } catch { return { getItem: () => null, setItem: () => {} }; }
}
function useLanguageState() {
  const [language, setLanguage] = useState<Language>(() => readLanguage(languageStorage()));
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `Chicappd — ${translate(language, "Kortkväll med vänner")}`;
  }, [language]);
  return useMemo(() => ({ language, locale: localeFor(language),
    t: ((key, values) => translate(language, key, values)) as Translator,
    message: (value: string) => localizeMessage(language, value),
    errorMessage: (value: string) => localizedError(language, value),
    setLanguage: (next: Language) => { saveLanguage(languageStorage(), next); setLanguage(next); },
  }), [language]);
}
const Context = createContext<ReturnType<typeof useLanguageState> | null>(null);
export function LanguageProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={useLanguageState()}>{children}</Context.Provider>;
}
export function useI18n() {
  const value = useContext(Context);
  if (!value) throw new Error("LanguageProvider is required");
  return value;
}
export function LanguageSwitch() {
  const { language, setLanguage, t } = useI18n();
  return <div className="language-bar"><label htmlFor="app-language">{t("Språk")}</label>
    <select id="app-language" value={language} onChange={event => setLanguage(event.target.value as Language)}>
      <option value="sv" lang="sv">Svenska</option><option value="en" lang="en">English</option>
    </select></div>;
}
