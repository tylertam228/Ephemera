export function Bi({ en, zh }: { en: string; zh: string }) {
  return (
    <span className="bi">
      <span>{en}</span>
      <small lang="zh-Hant">{zh}</small>
    </span>
  );
}

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false">
      <path d="M6 3h14l6 6v20H6z" fill="var(--note)" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M20 3v6h6" fill="var(--fold)" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 14h10M10 18h7" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
      <path d="M26 20.5l-3 2.2 1.2 1.8-3 1.2 1 2.1-2.7 1.2H26z" fill="var(--char)" />
      <circle cx="22.8" cy="24.6" r="1.4" fill="var(--ember)" />
    </svg>
  );
}
