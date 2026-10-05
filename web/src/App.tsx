import { FormEvent, useEffect, useState } from "react";
import { Compose } from "./compose";
import { createDevice, loadDevice, loadPrivateKey } from "./device";
import { openDrop } from "./drop.mjs";

type Me = { id: string; username: string; maxUploadMb: number };
type Device = { id: string; name: string };
type Recipient = Device & { publicKey: string };
type Drop = { id: string; expiresAt: number; createdAt: number; pin: boolean };

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
      <h1>Ephemera</h1>
      <p>Burn-after-reading handoff.</p>
      {failed ? <p>Sign-in failed.</p> : null}
      {me === undefined ? null : me ? (
        <>
          <p>{me.username}</p>
          {device === undefined ? null : device ? (
            <>
              <p>{device.name}</p>
              <Inbox
                drops={inbox}
                deviceId={device.id}
                userId={me.id}
                onClaimed={(id) => setInbox((current) => current?.filter((row) => row.id !== id))}
              />
              {recipients === undefined ? null : recipients.length === 0 ? (
                <p>Sign in on another device with this account before sending.</p>
              ) : (
                <Compose recipients={recipients} maxBytes={me.maxUploadMb * 1024 * 1024} />
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

type Opened = { texts: string[]; files: { name: string; type: string }[] };

export function Inbox({
  drops,
  deviceId,
  userId,
  onClaimed,
}: {
  drops: Drop[] | undefined;
  deviceId: string;
  userId: string;
  onClaimed: (id: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [opened, setOpened] = useState<Opened | null>(null);
  if (!drops && !opened) return null;

  async function open(drop: Drop) {
    if (busy) return;
    if (drop.pin && !pin) {
      setNotice("Enter the PIN.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const metaRes = await fetch(`/api/drops/${drop.id}?device=${encodeURIComponent(deviceId)}`);
      if (!metaRes.ok) throw new Error("gone");
      const meta = (await metaRes.json()) as { pinSalt: string | null; sealedKey: string };
      const blobRes = await fetch(`/api/drops/${drop.id}/blob?device=${encodeURIComponent(deviceId)}`);
      if (!blobRes.ok) throw new Error("gone");
      const privateKey = await loadPrivateKey(userId);
      if (!privateKey) throw new Error("key");
      const result = await openDrop({
        privateKey,
        pin,
        pinSalt: meta.pinSalt,
        sealedKey: meta.sealedKey,
        bytes: new Uint8Array(await blobRes.arrayBuffer()),
      });
      const claim = await fetch(`/api/drops/${drop.id}?device=${encodeURIComponent(deviceId)}`, {
        method: "DELETE",
      });
      if (!claim.ok) throw new Error("claim");
      setPin("");
      setOpened({
        texts: result.texts,
        files: result.files.map((file) => ({ name: file.name, type: file.type })),
      });
      onClaimed(drop.id);
    } catch (err) {
      const missed = err instanceof Error && (err.message === "gone" || err.message === "claim" || err.message === "key");
      setNotice(drop.pin && !missed ? "Wrong PIN." : "Could not open.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="inbox">
      <p>Inbox</p>
      {!drops ? null : drops.length === 0 ? (
        <p>Nothing waiting.</p>
      ) : (
        <ul>
          {drops.map((drop) => (
            <li key={drop.id}>
              Until {new Date(drop.expiresAt).toLocaleString()}
              {drop.pin ? ", PIN required" : ""}
              {drop.pin ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void open(drop);
                  }}
                >
                  <input
                    type="password"
                    value={pin}
                    autoComplete="off"
                    aria-label="PIN"
                    onChange={(event) => setPin(event.target.value)}
                  />
                  <button type="submit" disabled={busy}>
                    Open
                  </button>
                </form>
              ) : (
                <button type="button" disabled={busy} onClick={() => void open(drop)}>
                  Open
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {notice ? <p>{notice}</p> : null}
      {opened ? (
        <div className="opened">
          {opened.texts.map((text, index) => (
            <p key={index}>{text}</p>
          ))}
          {opened.files.map((file, index) => (
            <p key={index}>
              {file.name}
              {file.type ? ` ${file.type}` : ""}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
