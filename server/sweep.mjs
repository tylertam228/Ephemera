import { rm } from "node:fs/promises";
import { blobPath } from "./db.mjs";
import { log as writeLog } from "./log.mjs";

export async function sweepExpired(db, dataDir, now = Date.now(), log = writeLog) {
  const rows = db.prepare("SELECT id FROM drops WHERE expires_at <= ?").all(now);
  for (const row of rows) {
    try {
      await rm(blobPath(dataDir, row.id), { force: true });
      db.prepare("DELETE FROM drops WHERE id = ?").run(row.id);
      log("info", "drop_expired", { drop: row.id });
    } catch (err) {
      log("error", "sweep_failed", { drop: row.id, err: err instanceof Error ? err.message : "sweep failed" });
    }
  }
}
