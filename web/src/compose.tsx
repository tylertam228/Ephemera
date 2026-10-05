import { useState } from "react";
import { expiry, presets } from "./retention.mjs";

type Recipient = { id: string; name: string };

export function Compose({ recipients }: { recipients: Recipient[] }) {
  const [texts, setTexts] = useState([""]);
  const [files, setFiles] = useState<File[]>([]);
  const [pin, setPin] = useState("");
  const [preset, setPreset] = useState("1m");
  const [at, setAt] = useState("");
  const picked = at ? new Date(at).getTime() : null;
  const chosen = expiry({ preset, at: picked }, Date.now());
  const presetLabel = presets.find((row) => row[0] === preset)?.[1] ?? "";

  return (
    <form
      className="compose"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <p>To</p>
      <ul>
        {recipients.map((row) => (
          <li key={row.id}>{row.name}</li>
        ))}
      </ul>
      {texts.map((text, index) => (
        <div key={index}>
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
              onClick={() => setTexts(texts.filter((_, item) => item !== index))}
            >
              Remove text
            </button>
          ) : null}
        </div>
      ))}
      <button type="button" onClick={() => setTexts(texts.concat(""))}>
        Add text
      </button>
      <label className="file">
        Add files
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
      {files.length ? (
        <ul>
          {files.map((file, index) => (
            <li key={`${file.name}-${file.lastModified}-${index}`}>
              {file.name}
              {file.type ? ` ${file.type}` : ""}
              <button
                type="button"
                onClick={() => setFiles(files.filter((_, item) => item !== index))}
              >
                Remove file
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label>
        PIN
        <input
          type="password"
          value={pin}
          autoComplete="off"
          onChange={(event) => setPin(event.target.value)}
        />
      </label>
      <p>Optional. It stays in this browser.</p>
      <div role="radiogroup" aria-label="Keep for">
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
            {label}
          </button>
        ))}
      </div>
      <label>
        Or a time
        <input
          type="datetime-local"
          value={at}
          min={localStamp(new Date(Date.now() + 60_000))}
          onChange={(event) => setAt(event.target.value)}
        />
      </label>
      {at ? (
        chosen == null ? (
          <p>Pick a later time.</p>
        ) : (
          <p>Kept until {new Date(chosen).toLocaleString()}.</p>
        )
      ) : (
        <p>The timer starts when the upload finishes, then {presetLabel}.</p>
      )}
    </form>
  );
}

function localStamp(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
