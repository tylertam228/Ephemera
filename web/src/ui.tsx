export function Bi({ en, zh }: { en: string; zh: string }) {
  return (
    <span className="bi">
      <span>{en}</span>
      <small lang="zh-Hant">{zh}</small>
    </span>
  );
}

export function Logo() {
  return <img className="logo" src="/logo.png" width={32} height={32} alt="" aria-hidden="true" />;
}
