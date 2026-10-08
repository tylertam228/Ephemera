import { FormEvent, useState } from "react";
import { renameLocalDevice } from "./device";
import { useLang } from "./i18n";

export function Profile({
  username,
  deviceId,
  deviceName,
  userId,
  onRenamed,
}: {
  username: string;
  deviceId: string;
  deviceName: string;
  userId: string;
  onRenamed: (name: string) => void;
}) {
  const { t } = useLang();
  const [name, setName] = useState(deviceName);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"saved" | "failed" | "">("");

  async function save(event: FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (!next || next === deviceName || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch(`/api/devices/${deviceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) throw new Error("rename");
      await renameLocalDevice(userId, next);
      onRenamed(next);
      setNotice("saved");
    } catch {
      setNotice("failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card page">
      <dl className="profile-facts">
        <div>
          <dt>{t("discordName")}</dt>
          <dd>{username}</dd>
        </div>
        <div>
          <dt>{t("thisDevice")}</dt>
          <dd>
            <form className="device-name" onSubmit={(event) => void save(event)}>
              <input
                value={name}
                maxLength={40}
                autoComplete="off"
                aria-label={t("deviceName")}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
              <button type="submit" className="quiet" disabled={busy || !name.trim() || name.trim() === deviceName}>
                {t("rename")}
              </button>
            </form>
          </dd>
        </div>
      </dl>
      {notice === "saved" ? (
        <p className="notice" role="status">
          {t("deviceSaved")}
        </p>
      ) : null}
      {notice === "failed" ? (
        <p className="notice" role="status">
          {t("deviceFailed")}
        </p>
      ) : null}
      <form className="profile-out" action="/api/auth/logout" method="post">
        <button type="submit" className="quiet">
          {t("signOut")}
        </button>
      </form>
    </section>
  );
}
