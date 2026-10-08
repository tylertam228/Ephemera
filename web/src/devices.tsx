import { FormEvent, useState } from "react";
import { clearLocalDevice, renameLocalDevice } from "./device";
import { useLang } from "./i18n";

export type ManagedDevice = {
  id: string;
  name: string;
  publicKey: string;
  createdAt: number;
  disabled: boolean;
};

export function Devices({
  devices,
  currentId,
  userId,
  onChange,
}: {
  devices: ManagedDevice[] | undefined;
  currentId: string;
  userId: string;
  onChange: () => void;
}) {
  const { t } = useLang();
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  if (!devices) return null;

  async function rename(id: string, name: string) {
    if (busy || !name.trim()) return;
    setBusy(id);
    setNotice("");
    try {
      const res = await fetch(`/api/devices/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error("rename");
      if (id === currentId) await renameLocalDevice(userId, name.trim());
      onChange();
    } catch {
      setNotice("deviceFailed");
    } finally {
      setBusy("");
    }
  }

  async function setDisabled(id: string, disabled: boolean) {
    if (busy) return;
    setBusy(id);
    setNotice("");
    try {
      const res = await fetch(`/api/devices/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disabled }),
      });
      if (!res.ok) throw new Error("disable");
      onChange();
    } catch {
      setNotice("deviceFailed");
    } finally {
      setBusy("");
    }
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(id);
    setNotice("");
    try {
      const res = await fetch(`/api/devices/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete");
      if (id === currentId) {
        await clearLocalDevice(userId);
        window.location.reload();
        return;
      }
      onChange();
    } catch {
      setNotice("deviceFailed");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="card page devices">
      <p className="hint">{t("devicesHint")}</p>
      <ul className="device-list">
        {devices.map((row) => (
          <DeviceRow
            key={`${row.id}-${row.name}-${row.disabled}`}
            row={row}
            current={row.id === currentId}
            busy={busy === row.id}
            onRename={(name) => void rename(row.id, name)}
            onDisable={(disabled) => void setDisabled(row.id, disabled)}
            onRemove={() => void remove(row.id)}
          />
        ))}
      </ul>
      {notice ? (
        <p className="notice" role="status">
          {t("deviceFailed")}
        </p>
      ) : null}
    </section>
  );
}

function DeviceRow({
  row,
  current,
  busy,
  onRename,
  onDisable,
  onRemove,
}: {
  row: ManagedDevice;
  current: boolean;
  busy: boolean;
  onRename: (name: string) => void;
  onDisable: (disabled: boolean) => void;
  onRemove: () => void;
}) {
  const { t } = useLang();
  const [name, setName] = useState(row.name);

  function save(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === row.name) return;
    onRename(name);
  }

  return (
    <li className={row.disabled ? "device-row off" : "device-row"}>
      <form className="device-name" onSubmit={save}>
        <input
          value={name}
          maxLength={40}
          autoComplete="off"
          aria-label={t("deviceName")}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="quiet" disabled={busy || !name.trim() || name.trim() === row.name}>
          {t("rename")}
        </button>
      </form>
      <div className="device-meta">
        {current ? <span className="hint">{t("thisDevice")}</span> : null}
        {row.disabled ? <span className="hint">{t("disabled")}</span> : null}
      </div>
      <div className="device-actions">
        <button type="button" className="quiet" disabled={busy} onClick={() => onDisable(!row.disabled)}>
          {row.disabled ? t("enable") : t("disable")}
        </button>
        <button type="button" className="quiet" disabled={busy} onClick={onRemove}>
          {t("deleteDevice")}
        </button>
      </div>
    </li>
  );
}
