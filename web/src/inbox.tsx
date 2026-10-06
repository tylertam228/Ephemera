import { useEffect, useState } from "react";
import { loadPrivateKey } from "./device";
import { openDrop } from "./drop.mjs";
import { formatTime, useLang, type Copy } from "./i18n";

export type Drop = {
  id: string;
  expiresAt: number;
  createdAt: number;
  pin: boolean;
  fromDevice: string | null;
  fromUser: string;
};

type OpenedFile = { name: string; type: string; bytes: Uint8Array };
type Opened = { key: string; texts: string[]; files: OpenedFile[]; fromDevice: string | null; fromUser: string };

const messages = {
  pin: "enterPin",
  wrong: "wrongPin",
  failed: "openFailed",
  copied: "copied",
  nocopy: "copyFailed",
} as const satisfies Record<string, keyof Copy>;

type Message = keyof typeof messages;

function burnDelay() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 600;
}

function Sender({ device, user }: { device: string | null; user: string }) {
  const { t } = useLang();
  return (
    <div>
      <dt>{t("from")}</dt>
      <dd>
        {device ?? t("unknownDevice")}
        <span className="user"> · {user}</span>
      </dd>
    </div>
  );
}

function Notice({ name }: { name: Message }) {
  const { t } = useLang();
  return (
    <p className="notice" role="status">
      {t(messages[name])}
    </p>
  );
}

function Note({
  drop,
  now,
  burning,
  busy,
  onOpen,
}: {
  drop: Drop;
  now: number;
  burning: boolean;
  busy: boolean;
  onOpen: (pin: string) => void;
}) {
  const { lang, t } = useLang();
  const [pin, setPin] = useState("");
  const total = drop.expiresAt - drop.createdAt;
  const left = total > 0 ? ((drop.expiresAt - now) / total) * 100 : 0;
  const percent = Math.max(0, Math.min(100, Math.round(left)));

  return (
    <li className={burning ? "slot burn" : "slot"}>
      <div className="clip">
        <form
          className="note"
          onSubmit={(event) => {
            event.preventDefault();
            onOpen(pin);
          }}
        >
          <dl className="facts">
            <Sender device={drop.fromDevice} user={drop.fromUser} />
            <div>
              <dt>{t("until")}</dt>
              <dd>{formatTime(drop.expiresAt, lang)}</dd>
            </div>
          </dl>
          {drop.pin ? (
            <div className="pin">
              <span className="hint">{t("pinRequired")}</span>
              <input
                type="password"
                value={pin}
                autoComplete="off"
                aria-label="PIN"
                onChange={(event) => setPin(event.target.value)}
              />
            </div>
          ) : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy || burning}>
              {t("open")}
            </button>
          </div>
          <div
            className={percent < 20 ? "burnbar low" : "burnbar"}
            role="progressbar"
            aria-label={t("timeLeft")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
        </form>
        <span className="front" aria-hidden="true" />
      </div>
    </li>
  );
}

export function Inbox({
  drops,
  deviceId,
  userId,
  onRemove,
}: {
  drops: Drop[] | undefined;
  deviceId: string;
  userId: string;
  onRemove: (id: string) => void;
}) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | "">("");
  const [opened, setOpened] = useState<Opened[]>([]);
  const [burning, setBurning] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!drops) return;
    const due = drops.filter((drop) => drop.expiresAt <= now && !burning.includes(drop.id)).map((drop) => drop.id);
    if (!due.length) return;
    setBurning((current) => current.concat(due.filter((id) => !current.includes(id))));
    setTimeout(() => due.forEach(onRemove), burnDelay());
  }, [drops, now, burning, onRemove]);

  if (!drops && opened.length === 0) return null;

  async function open(drop: Drop, pin: string) {
    if (busy) return;
    if (drop.pin && !pin) {
      setMessage("pin");
      return;
    }
    setBusy(true);
    setMessage("");
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
      setBurning((current) => current.concat(drop.id));
      await new Promise((resolve) => setTimeout(resolve, burnDelay()));
      onRemove(drop.id);
      setOpened((current) =>
        current.concat({
          key: drop.id,
          texts: result.texts,
          files: result.files,
          fromDevice: drop.fromDevice,
          fromUser: drop.fromUser,
        }),
      );
    } catch (err) {
      const missed = err instanceof Error && (err.message === "gone" || err.message === "claim" || err.message === "key");
      setMessage(drop.pin && !missed ? "wrong" : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="inbox">
      <h2>{t("inbox")}</h2>
      {!drops ? null : drops.length === 0 ? (
        <p className="empty">{t("empty")}</p>
      ) : (
        <ul className="notes">
          {drops.map((drop) => (
            <Note
              key={drop.id}
              drop={drop}
              now={now}
              burning={burning.includes(drop.id)}
              busy={busy}
              onOpen={(pin) => void open(drop, pin)}
            />
          ))}
        </ul>
      )}
      {message ? <Notice name={message} /> : null}
      {opened.map((item) => (
        <Review
          key={item.key}
          item={item}
          onClose={() => setOpened((current) => current.filter((row) => row.key !== item.key))}
        />
      ))}
    </section>
  );
}

function Review({ item, onClose }: { item: Opened; onClose: () => void }) {
  const { t } = useLang();
  const [copied, setCopied] = useState<Message | "">("");
  const [closing, setClosing] = useState(false);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("copied");
    } catch {
      setCopied("nocopy");
    }
  }

  function download(file: OpenedFile) {
    const url = URL.createObjectURL(
      new Blob([file.bytes.slice()], { type: file.type || "application/octet-stream" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name || "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function close() {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, burnDelay());
  }

  return (
    <div className={closing ? "slot burn" : "slot"}>
      <div className="clip">
        <div className="note opened">
          <dl className="facts">
            <Sender device={item.fromDevice} user={item.fromUser} />
          </dl>
          {item.texts.map((text, index) => (
            <div className="block" key={index}>
              <p>{text}</p>
              <button type="button" className="pill" onClick={() => void copy(text)}>
                {t("copy")}
              </button>
            </div>
          ))}
          {item.files.map((file, index) => (
            <div className="block" key={index}>
              <p>
                {file.name}
                {file.type ? <span className="user"> {file.type}</span> : null}
              </p>
              <button type="button" className="pill" onClick={() => download(file)}>
                {t("download")}
              </button>
            </div>
          ))}
          {copied ? <Notice name={copied} /> : null}
          <div className="actions">
            <button type="button" className="quiet" disabled={closing} onClick={close}>
              {t("close")}
            </button>
          </div>
        </div>
        <span className="front" aria-hidden="true" />
      </div>
    </div>
  );
}
