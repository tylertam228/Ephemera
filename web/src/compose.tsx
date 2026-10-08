import { FormEvent, useRef, useState } from "react";
import { prepareDrop, uploadDrop } from "./drop.mjs";
import { formatTime, useLang, type Copy } from "./i18n";
import { expiry, presets } from "./retention.mjs";

type Recipient = { id: string; name: string; publicKey: string };

const notices = {
  sent: "sent",
  cap: "tooLarge",
  failed: "sendFailed",
  abort: "sendCancelled",
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
  const [preset, setPreset] = useState("1m");
  const [at, setAt] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState<keyof typeof notices | "">("");
  const [skipped, setSkipped] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const selected = recipients.filter((row) => !skipped.includes(row.id));
  const picked = at ? new Date(at).getTime() : null;
  const chosen = expiry({ preset, at: picked }, Date.now());
  const presetRow = presets.find((row) => row[0] === preset);
  const presetKey = `keep_${preset}` as keyof Copy;
  const ready = selected.length > 0 && (texts.some((text) => text.trim()) || files.length > 0) && (!at || chosen != null);

  async function send(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!ready || sending || !presetRow) return;
    const control = new AbortController();
    abortRef.current = control;
    setSending(true);
    setProgress(0);
    setNotice("");
    try {
      const prepared = await prepareDrop({
        recipients: selected,
        texts: texts.filter((text) => text.trim()),
        files,
        maxBytes,
      });
      await uploadDrop({
        senderDeviceId: deviceId,
        keys: prepared.keys,
        frames: prepared.frames,
        signal: control.signal,
        onProgress: (loaded, total) => setProgress(total ? Math.round((loaded / total) * 100) : 0),
        ...(at ? { expiresAt: picked ?? undefined } : { keepMs: presetRow[2] }),
      });
      setTexts([""]);
      setFiles([]);
      setAt("");
      setPreset("1m");
      setProgress(100);
      setNotice("sent");
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "abort") setNotice("abort");
      else if (err instanceof Error && "code" in err && err.code === "cap") setNotice("cap");
      else setNotice("failed");
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  return (
    <form className="card compose" onSubmit={(event) => void send(event)}>
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
      {sending ? (
        <div className="upload">
          <div
            className="upload-bar"
            role="progressbar"
            aria-label={t("uploadProgress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="hint">
            {t("uploading", `${progress}`)}
          </p>
          <button type="button" className="quiet" onClick={cancel}>
            {t("cancelUpload")}
          </button>
        </div>
      ) : (
        <div className="send-row">
          <button type="submit" className="primary send" disabled={!ready}>
            {notice === "failed" || notice === "abort" ? t("retry") : t("send")}
          </button>
        </div>
      )}
      {notice && !sending ? (
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
