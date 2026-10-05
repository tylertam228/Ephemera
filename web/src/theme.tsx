import { useEffect, useState } from "react";

const themes = [
  { id: "paper", en: "Paper", zh: "紙張", swatch: "#F4EEE3" },
  { id: "ash", en: "Ash", zh: "炭灰", swatch: "#1C1A18" },
  { id: "ember", en: "Ember", zh: "夜燼", swatch: "#120D0B" },
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
    <div className="themes" role="radiogroup" aria-label="Theme 主題">
      {themes.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={theme === item.id}
          aria-label={`${item.en} ${item.zh}`}
          title={`${item.en} ${item.zh}`}
          className="swatch"
          style={{ background: item.swatch }}
          onClick={() => setTheme(item.id)}
        />
      ))}
    </div>
  );
}
