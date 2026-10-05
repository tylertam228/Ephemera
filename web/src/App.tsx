import { FormEvent, useEffect, useState } from "react";
import { Compose } from "./compose";
import { createDevice, loadDevice } from "./device";
import { Drop, Inbox } from "./inbox";
import { ThemeSwitch } from "./theme";
import { Bi, Logo } from "./ui";

type Me = { id: string; username: string; maxUploadMb: number };
type Device = { id: string; name: string };
type Recipient = Device & { publicKey: string };

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [device, setDevice] = useState<Device | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[] | undefined>(undefined);
  const [inbox, setInbox] = useState<Drop[] | undefined>(undefined);
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
          setInbox((await res.json()) as Drop[]);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      gone = true;
      window.removeEventListener("focus", load);
    };
  }, [device]);

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
        <ThemeSwitch />
      </header>
      <p className="tag">
        <Bi en="Burn-after-reading handoff." zh="閱後即焚的傳遞。" />
      </p>
      {failed ? (
        <p className="notice" role="alert">
          <Bi en="Sign-in failed." zh="登入失敗。" />
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
                <Bi en="Sign out" zh="登出" />
              </button>
            </form>
          </div>
          {device === undefined ? null : device ? (
            <>
              <Inbox
                drops={inbox}
                deviceId={device.id}
                userId={me.id}
                onRemove={(id) => setInbox((current) => current?.filter((row) => row.id !== id))}
              />
              {recipients === undefined ? null : recipients.length === 0 ? (
                <p className="notice">
                  <Bi
                    en="Sign in on another device with this account before sending."
                    zh="請先用同一個帳號在另一台裝置登入，才能傳送。"
                  />
                </p>
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
              <input name="name" required maxLength={40} autoComplete="off" aria-label="Device name" />
              <button type="submit" className="primary" disabled={busy}>
                <Bi en="Save this device" zh="儲存此裝置" />
              </button>
              {error ? (
                <p className="notice" role="alert">
                  <Bi en="Could not save this device." zh="無法儲存此裝置。" />
                </p>
              ) : null}
            </form>
          )}
        </>
      ) : (
        <p>
          <a className="primary" href="/api/auth/discord">
            <Bi en="Sign in with Discord" zh="使用 Discord 登入" />
          </a>
        </p>
      )}
    </main>
  );
}
