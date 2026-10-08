import { FormEvent, useEffect, useState } from "react";
import { Compose } from "./compose";
import { createDevice, loadDevice } from "./device";
import { Devices, type ManagedDevice } from "./devices";
import { LangSwitch, useLang } from "./i18n";
import { Drop, Inbox } from "./inbox";
import { ThemeSwitch } from "./theme";
import { Logo } from "./ui";

type Me = { id: string; username: string; maxUploadMb: number };
type Device = { id: string; name: string };

export function App() {
  const { t } = useLang();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [device, setDevice] = useState<Device | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [devices, setDevices] = useState<ManagedDevice[] | undefined>(undefined);
  const [inbox, setInbox] = useState<Drop[] | undefined>(undefined);
  const [fresh, setFresh] = useState(false);
  const failed = new URLSearchParams(window.location.search).get("auth") === "failed";
  const recipients = devices
    ?.filter((row) => row.id !== device?.id && !row.disabled)
    .map((row) => ({ id: row.id, name: row.name, publicKey: row.publicKey }));

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
    const deviceId = device.id;
    let gone = false;
    let primed = false;
    let known = new Set<string>();
    setInbox(undefined);
    const load = () => {
      fetch("/api/devices")
        .then(async (res) => {
          if (!res.ok || gone) return;
          const rows = (await res.json()) as ManagedDevice[];
          setDevices(rows);
          const mine = rows.find((row) => row.id === deviceId);
          if (mine) {
            setDevice((current) =>
              current && current.id === mine.id && current.name !== mine.name
                ? { id: mine.id, name: mine.name }
                : current,
            );
          }
        })
        .catch(() => {});
      fetch(`/api/drops?device=${encodeURIComponent(deviceId)}`)
        .then(async (res) => {
          if (!res.ok || gone) return;
          const next = (await res.json()) as Drop[];
          const arrived = primed && next.some((row) => !known.has(row.id));
          known = new Set(next.map((row) => row.id));
          primed = true;
          setInbox(next);
          setFresh(arrived);
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
  }, [device?.id]);

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

  function refreshDevices() {
    fetch("/api/devices")
      .then(async (res) => {
        if (!res.ok || !device) return;
        const rows = (await res.json()) as ManagedDevice[];
        setDevices(rows);
        const mine = rows.find((row) => row.id === device.id);
        if (mine) setDevice({ id: mine.id, name: mine.name });
      })
      .catch(() => {});
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
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="quiet">
                {t("signOut")}
              </button>
            </form>
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
              <Devices
                devices={devices}
                currentId={device.id}
                userId={me.id}
                onChange={refreshDevices}
              />
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
