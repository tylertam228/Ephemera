import { hashToken } from "./db.mjs";

export function readCookie(req, name) {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

export function sessionUser(req, db) {
  const token = readCookie(req, "session");
  if (!token) return undefined;
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  return db
    .prepare(
      `SELECT users.id AS id, users.username AS username
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .get(hashToken(token), now);
}
