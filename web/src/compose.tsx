import { FormEvent, useState } from "react";
import { prepareDrop, uploadDrop } from "./drop.mjs";
import { formatTime, useLang, type Copy } from "./i18n";
import { expiry, presets } from "./retention.mjs";

type Recipient = { id: string; name: string; publicKey: string };

const notices = {
  sent: "sent",
  cap: "tooLarge",
  failed: "sendFailed",
} as const;

export function Compose({
  recipients,
  maxBytes,
  deviceId,
}: {
  recipients: Recipient[];
  maxBytes: number;
  deviceId: string;
}) {
  const { lang, t } = useLang();
  const [texts, setTexts] = useState([""]);
  const [files, setFiles] = useState<File[]>([]);
  const [pin, setPin] = useState("");
  const [preset, setPreset] = useState("1m");
  const [at, setAt] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<keyof typeof notices | "">("");
  const [skipped, setSkipped] = useState<string[]>([]);
  const selected = recipients.filter((row) => !skipped.includes(row.id));
  const picked = at ? new Date(at).getTime() : null;
  const chosen = expiry({ preset, at: picked }, Date.now());
  const presetRow = presets.find((row) => row[0] === preset);
  const presetKey = `keep_${preset}` as keyof Copy;
  const ready = selected.length > 0 && (texts.some((text) => text.trim()) || files.length > 0) && (!at || chosen != null);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || sending || !presetRow) return;
    setSending(true);
    setNotice("");
    try {
      const prepared = await prepareDrop({
        recipients: selected,
        texts: texts.filter((text) => text.trim()),
        files,
        pin,
        maxBytes,
      });
      await uploadDrop({
        senderDeviceId: deviceId,
        pinSalt: prepared.pinSalt,
        keys: prepared.keys,
        frames: prepared.frames,
        ...(at ? { expiresAt: picked ?? undefined } : { keepMs: presetRow[2] }),
      });
      setTexts([""]);
      setFiles([]);
      setPin("");
      setAt("");
      setPreset("1m");
      setNotice("sent");
    } catch (err) {
      setNotice(err instanceof Error && "code" in err && err.code === "cap" ? "cap" : "failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="card compose" onSubmit={send}>
      <div>
        <span className="label">{t("to")}</span>
        <ul className="targets">
          {recipients.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                aria-pressed={!skipped.includes(row.id)}
                onClick={() =>
                  setSkipped((current) =>
                    current.includes(row.id) ? current.filter((id) => id !== row.id) : current.concat(row.id),
                  )
                }
              >
                {row.name}
              </button>
            </li>
          ))}
        </ul>
        {selected.length === 0 ? <p className="hint">{t("pickDevice")}</p> : null}
      </div>
      {texts.map((text, index) => (
        <div className="text" key={index}>
          <textarea
            aria-label={t("text", String(index + 1))}
            value={text}
            onChange={(event) => {
              const next = texts.slice();
              next[index] = event.target.value;
              setTexts(next);
            }}
          />
          {texts.length > 1 ? (
            <button
              type="button"
              className="quiet"
              onClick={() => setTexts(texts.filter((_, item) => item !== index))}
            >
              {t("removeText")}
            </button>
          ) : null}
        </div>
      ))}
      <div className="adders">
        <button type="button" className="quiet" onClick={() => setTexts(texts.concat(""))}>
          {t("addText")}
        </button>
        <label className="quiet file">
          {t("addFiles")}
          <input
            type="file"
            multiple
            aria-label={t("files")}
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (picked.length) setFiles((current) => current.concat(picked));
            }}
          />
        </label>
      </div>
      {files.length ? (
        <ul className="files">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.lastModified}-${index}`}>
              <span>
                {file.name}
                {file.type ? <span className="user"> {file.type}</span> : null}
              </span>
              <button
                type="button"
                className="quiet"
                onClick={() => setFiles(files.filter((_, item) => item !== index))}
              >
                {t("removeFile")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="field">
        <span className="label">{t("pinOptional")}</span>
        <input type="password" value={pin} autoComplete="off" onChange={(event) => setPin(event.target.value)} />
        <span className="hint">{t("pinStays")}</span>
      </label>
      <div className="keep" role="radiogroup" aria-label={t("keepFor")}>
        {presets.map(([id]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={!at && preset === id}
            onClick={() => {
              setPreset(id);
              setAt("");
            }}
          >
            {t(`keep_${id}` as keyof Copy)}
          </button>
        ))}
      </div>
      <label className="field">
        <span className="label">{t("orTime")}</span>
        <input
          type="datetime-local"
          value={at}
          min={localStamp(new Date(Date.now() + 60_000))}
          onChange={(event) => setAt(event.target.value)}
        />
      </label>
      <p className="hint">
        {at
          ? chosen == null
            ? t("laterTime")
            : t("keptUntil", formatTime(chosen, lang))
          : t("timerStarts", t(presetKey))}
      </p>
      <button type="submit" className="primary send" disabled={sending || !ready}>
        {sending ? t("sending") : t("send")}
      </button>
      {notice ? (
        <p className="notice" role="status">
          {t(notices[notice])}
        </p>
      ) : null}
    </form>
  );
}

function localStamp(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
