import { FormEvent, useState } from "react";
import { prepareDrop, uploadDrop } from "./drop.mjs";
import { expiry, presets } from "./retention.mjs";
import { Bi } from "./ui";

type Recipient = { id: string; name: string; publicKey: string };

const presetZh: Record<string, string> = {
  "1m": "1 分鐘",
  "5m": "5 分鐘",
  "15m": "15 分鐘",
  "1h": "1 小時",
  "1d": "1 天",
  "7d": "7 天",
  "30d": "30 天",
};

const notices = {
  sent: ["Sent.", "已傳送。"],
  cap: ["That drop is too large.", "內容太大。"],
  failed: ["Could not send.", "無法傳送。"],
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
  const presetLabel = presetRow?.[1] ?? "";
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
        <span className="label">
          <Bi en="To" zh="收件裝置" />
        </span>
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
        {selected.length === 0 ? (
          <p className="hint">
            <Bi en="Pick at least one device." zh="請至少選擇一台裝置。" />
          </p>
        ) : null}
      </div>
      {texts.map((text, index) => (
        <div className="text" key={index}>
          <textarea
            aria-label={`Text ${index + 1}`}
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
              <Bi en="Remove text" zh="移除文字" />
            </button>
          ) : null}
        </div>
      ))}
      <div className="adders">
        <button type="button" className="quiet" onClick={() => setTexts(texts.concat(""))}>
          <Bi en="Add text" zh="新增文字" />
        </button>
        <label className="quiet file">
          <Bi en="Add files" zh="新增檔案" />
          <input
            type="file"
            multiple
            aria-label="Files"
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
                <Bi en="Remove file" zh="移除檔案" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="field">
        <span className="label">
          <Bi en="PIN (optional)" zh="PIN（選填）" />
        </span>
        <input
          type="password"
          value={pin}
          autoComplete="off"
          onChange={(event) => setPin(event.target.value)}
        />
        <span className="hint">
          <Bi en="It stays in this browser." zh="只留在此瀏覽器。" />
        </span>
      </label>
      <div className="keep" role="radiogroup" aria-label="Keep for 保留時間">
        {presets.map(([id, label]) => (
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
            <Bi en={label} zh={presetZh[id] ?? label} />
          </button>
        ))}
      </div>
      <label className="field">
        <span className="label">
          <Bi en="Or a time" zh="或指定時間" />
        </span>
        <input
          type="datetime-local"
          value={at}
          min={localStamp(new Date(Date.now() + 60_000))}
          onChange={(event) => setAt(event.target.value)}
        />
      </label>
      <p className="hint">
        {at ? (
          chosen == null ? (
            <Bi en="Pick a later time." zh="請選擇較晚的時間。" />
          ) : (
            <Bi
              en={`Kept until ${new Date(chosen).toLocaleString()}.`}
              zh={`保留至 ${new Date(chosen).toLocaleString()}。`}
            />
          )
        ) : (
          <Bi
            en={`The timer starts when the upload finishes, then ${presetLabel}.`}
            zh={`上傳完成後開始計時，保留 ${presetZh[preset] ?? presetLabel}。`}
          />
        )}
      </p>
      <button type="submit" className="primary send" disabled={sending || !ready}>
        {sending ? <Bi en="Sending…" zh="傳送中…" /> : <Bi en="Send" zh="傳送" />}
      </button>
      {notice ? (
        <p className="notice" role="status">
          <Bi en={notices[notice][0]} zh={notices[notice][1]} />
        </p>
      ) : null}
    </form>
  );
}

function localStamp(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
