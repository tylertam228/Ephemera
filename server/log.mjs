const dropKey = /secret|token|verifier|password|pin|authorization|cookie|code/i;

export function logfmt(level, msg, fields = {}) {
  const parts = [`ts=${new Date().toISOString()}`, `level=${level}`, `msg=${encode(msg)}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (dropKey.test(key)) continue;
    parts.push(`${safeKey(key)}=${encode(String(value))}`);
  }
  return parts.join(" ");
}

export function log(level, msg, fields) {
  const line = logfmt(level, msg, fields);
  if (level === "error") console.error(line);
  else console.log(line);
}

function safeKey(key) {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(key) ? key : "field";
}

function encode(value) {
  if (value === "") return '""';
  if (/^[\w.@:/-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}
