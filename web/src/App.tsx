import { FormEvent, useEffect, useState } from "react";
import { Compose } from "./compose";
import { createDevice, loadDevice } from "./device";
import { LangSwitch, useLang } from "./i18n";
import { Drop, Inbox } from "./inbox";
import { ThemeSwitch } from "./theme";
import { Logo } from "./ui";

type Me = { id: string; username: string; maxUploadMb: number };
type Device = { id: string; name: string };
type Recipient = Device & { publicKey: string };

export function App() {
  const { t } = useLang();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [device, setDevice] = useState<Device | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[] | undefined>(undefined);
  const [inbox, setInbox] = useState<Drop[] | undefined>(undefined);
  const [fresh, setFresh] = useState(false);
  const failed = new URLSearchParams(window.location.search).get("auth") === "failed";

  useEffect(() => {
    let gone = false;
    fetch("/api/me")
      .then(async (res) => {
        if (gone) return;
        if (!res.ok) {
          setMe(null);
          return;
        }
        setMe((await res.json()) as Me);
      })
      .catch(() => {
        if (!gone) setMe(null);
      });
    return () => {
      gone = true;
    };
  }, []);

  useEffect(() => {
    if (!me) return;
    let gone = false;
    loadDevice(me.id)
      .then((row) => {
        if (!gone) setDevice(row ? { id: row.deviceId, name: row.name } : null);
      })
      .catch(() => {
        if (!gone) setDevice(null);
      });
    return () => {
      gone = true;
    };
  }, [me]);

  useEffect(() => {
    if (!device) return;
    let gone = false;
    let primed = false;
    let known = new Set<string>();
    setInbox(undefined);
    const load = () => {
      fetch(`/api/devices?except=${encodeURIComponent(device.id)}`)
        .then(async (res) => {
          if (!res.ok || gone) return;
          setRecipients((await res.json()) as Recipient[]);
        })
        .catch(() => {});
      fetch(`/api/drops?device=${encodeURIComponent(device.id)}`)
        .then(async (res) => {
          if (!res.ok || gone) return;
          const next = (await res.json()) as Drop[];
          const arrived = primed && next.some((row) => !known.has(row.id));
          known = new Set(next.map((row) => row.id));
          primed = true;
          setInbox(next);
          setFresh(arrived);
          if (arrived && typeof Notification !== "undefined" && Notification.permission === "granted") {
            const note = new Notification(t("notifyTitle"), { body: t("notifyBody") });
            note.onclick = () => {
              window.focus();
              note.close();
            };
          }
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 5000);
    const onFocus = () => load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      gone = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [device, t]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!me) return;
    const name = new FormData(event.currentTarget).get("name");
    if (typeof name !== "string" || !name.trim()) return;
    setBusy(true);
    setError(false);
    try {
      const saved = await createDevice(me.id, name.trim());
      setDevice({ id: saved.deviceId, name: saved.name });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header className="top">
        <h1>
          <Logo />
          <span>Ephemera</span>
        </h1>
        <div className="picks">
          <LangSwitch />
          <ThemeSwitch />
        </div>
      </header>
      <p className="tag">{t("tag")}</p>
      {failed ? (
        <p className="notice" role="alert">
          {t("signInFailed")}
        </p>
      ) : null}
      {me === undefined ? null : me ? (
        <>
          <div className="who">
            <span>
              {me.username}
              {device ? <span className="user"> · {device.name}</span> : null}
            </span>
            <span className="who-actions">
              <Alerts />
              <form action="/api/auth/logout" method="post">
                <button type="submit" className="quiet">
                  {t("signOut")}
                </button>
              </form>
            </span>
          </div>
          {device === undefined ? null : device ? (
            <>
              {fresh ? (
                <p className="notice" role="status">
                  {t("fresh")}
                </p>
              ) : null}
              <Inbox
                drops={inbox}
                deviceId={device.id}
                userId={me.id}
                onRemove={(id) => setInbox((current) => current?.filter((row) => row.id !== id))}
              />
              {recipients === undefined ? null : recipients.length === 0 ? (
                <p className="notice">{t("needOtherDevice")}</p>
              ) : (
                <Compose
                  recipients={recipients}
                  maxBytes={me.maxUploadMb * 1024 * 1024}
                  deviceId={device.id}
                />
              )}
            </>
          ) : (
            <form className="card" onSubmit={save}>
              <input name="name" required maxLength={40} autoComplete="off" aria-label={t("deviceName")} />
              <button type="submit" className="primary" disabled={busy}>
                {t("saveDevice")}
              </button>
              {error ? (
                <p className="notice" role="alert">
                  {t("saveFailed")}
                </p>
              ) : null}
            </form>
          )}
        </>
      ) : (
        <p>
          <a className="primary" href="/api/auth/discord">
            {t("signIn")}
          </a>
        </p>
      )}
    </main>
  );
}

function Alerts() {
  const { t } = useLang();
  const supported = typeof Notification !== "undefined";
  const [permission, setPermission] = useState(supported ? Notification.permission : "denied");
  if (!supported || permission !== "default") return null;
  return (
    <button
      type="button"
      className="quiet"
      onClick={() => {
        void Notification.requestPermission().then(setPermission);
      }}
    >
      {t("notify")}
    </button>
  );
}
