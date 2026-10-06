import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import en from "./locales/en.json";
import zhTW from "./locales/zhTW.json";

export const langs = ["en", "zhTW"] as const;
export type Lang = (typeof langs)[number];
export type Copy = typeof en;

const packs: Record<Lang, Copy> = { en, zhTW };
const htmlLang: Record<Lang, string> = { en: "en", zhTW: "zh-Hant" };
const dates: Record<Lang, string> = { en: "en", zhTW: "zh-Hant" };

function savedLang(): Lang {
  try {
    const value = localStorage.getItem("lang");
    if (value === "en" || value === "zhTW") return value;
  } catch {
    return fallbackLang();
  }
  return fallbackLang();
}

function fallbackLang(): Lang {
  const tag = typeof navigator === "undefined" ? "en" : navigator.language;
  return /^zh(-|$)/i.test(tag) ? "zhTW" : "en";
}

document.documentElement.lang = htmlLang[savedLang()];

type Ctx = { lang: Lang; setLang: (lang: Lang) => void; t: (key: keyof Copy, fill?: string) => string };

const LangCtx = createContext<Ctx>({
  lang: "en",
  setLang: () => {},
  t: (key, fill) => fillText(en[key], fill),
});

function fillText(text: string, fill?: string) {
  return fill == null ? text : text.replaceAll("{0}", fill);
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState(savedLang);
  useEffect(() => {
    document.documentElement.lang = htmlLang[lang];
    try {
      localStorage.setItem("lang", lang);
    } catch {
      return;
    }
  }, [lang]);
  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang,
      t: (key, fill) => fillText(packs[lang][key], fill),
    }),
    [lang],
  );
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useLang() {
  return useContext(LangCtx);
}

export function formatTime(value: number, lang: Lang) {
  return new Date(value).toLocaleString(dates[lang]);
}

export function LangSwitch() {
  const { lang, setLang, t } = useLang();
  return (
    <div className="langs" role="radiogroup" aria-label={t("lang")}>
      {langs.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={lang === id}
          onClick={() => setLang(id)}
        >
          {id === "en" ? t("langEn") : t("langZh")}
        </button>
      ))}
    </div>
  );
}
