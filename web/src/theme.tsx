import { useEffect, useState } from "react";

import { useLang } from "./i18n";

const themes = [
  { id: "paper", key: "themePaper", swatch: "#F4EEE3" },
  { id: "ash", key: "themeAsh", swatch: "#1C1A18" },
  { id: "ember", key: "themeEmber", swatch: "#120D0B" },
] as const;

function saved(): string {
  try {
    const value = localStorage.getItem("theme");
    return themes.some((theme) => theme.id === value) && value ? value : "paper";
  } catch {
    return "paper";
  }
}

document.documentElement.dataset.theme = saved();

export function ThemeSwitch() {
  const { t } = useLang();
  const [theme, setTheme] = useState(saved);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      return;
    }
  }, [theme]);

  return (
    <div className="themes" role="radiogroup" aria-label={t("theme")}>
      {themes.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={theme === item.id}
          aria-label={t(item.key)}
          title={t(item.key)}
          className="swatch"
          style={{ background: item.swatch }}
          onClick={() => setTheme(item.id)}
        />
      ))}
    </div>
  );
}
