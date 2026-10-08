import { useEffect, useRef, useState } from "react";
import { useLang } from "./i18n";

export type View = "home" | "profile" | "devices" | "display" | "language";

export function AccountMenu({
  view,
  onGo,
}: {
  view: View;
  onGo: (view: View) => void;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function go(next: View) {
    setOpen(false);
    onGo(next);
  }

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className="menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("menu")}
        onClick={() => setOpen((current) => !current)}
      >
        <MenuIcon />
      </button>
      {open ? (
        <div className="menu-panel" role="menu">
          <MenuItem current={view === "profile"} onClick={() => go("profile")}>
            {t("profile")}
          </MenuItem>
          <MenuItem current={view === "devices"} onClick={() => go("devices")}>
            {t("manageDevices")}
          </MenuItem>
          <MenuItem current={view === "display"} onClick={() => go("display")}>
            {t("displayMode")}
          </MenuItem>
          <MenuItem current={view === "language"} onClick={() => go("language")}>
            {t("lang")}
          </MenuItem>
          <button type="button" className="menu-item" role="menuitem" disabled>
            {t("support")}
            <span className="menu-soon">{t("soon")}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  current,
  onClick,
  children,
}: {
  current: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      className={current ? "menu-item on" : "menu-item"}
      role="menuitem"
      aria-current={current ? "page" : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="7" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3.5 17c1.4-3.2 3.6-4.8 6.5-4.8S15.1 13.8 16.5 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
