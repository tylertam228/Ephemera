import { FormEvent, useEffect, useState } from "react";
import { createDevice, loadDevice } from "./device";

type Me = { id: string; username: string };
type Device = { id: string; name: string };

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [device, setDevice] = useState<Device | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [recipients, setRecipients] = useState<Device[] | undefined>(undefined);
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
    const load = () => {
      fetch(`/api/devices?except=${encodeURIComponent(device.id)}`)
        .then(async (res) => {
          if (!res.ok || gone) return;
          setRecipients((await res.json()) as Device[]);
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
      <h1>Ephemera</h1>
      <p>Burn-after-reading handoff.</p>
      {failed ? <p>Sign-in failed.</p> : null}
      {me === undefined ? null : me ? (
        <>
          <p>{me.username}</p>
          {device === undefined ? null : device ? (
            <>
              <p>{device.name}</p>
              {recipients === undefined ? null : recipients.length === 0 ? (
                <p>Sign in on another device with this account before sending.</p>
              ) : (
                <ul>
                  {recipients.map((row) => (
                    <li key={row.id}>{row.name}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <form onSubmit={save}>
              <input name="name" required maxLength={40} autoComplete="off" aria-label="Device name" />
              <button type="submit" disabled={busy}>
                Save this device
              </button>
              {error ? <p>Could not save this device.</p> : null}
            </form>
          )}
          <form action="/api/auth/logout" method="post">
            <button type="submit">Sign out</button>
          </form>
        </>
      ) : (
        <p>
          <a href="/api/auth/discord">Sign in with Discord</a>
        </p>
      )}
    </main>
  );
}
