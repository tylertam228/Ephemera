const riskyExt =
  /\.(exe|dll|com|scr|bat|cmd|ps1|vbs|js|jse|wsf|msi|apk|dmg|pkg|sh|bash|zsh|command|app|jar|hta|cpl|msc|reg|lnk|url)$/i;

export function scanFile({ name, bytes }) {
  const flags = [];
  if (riskyExt.test(name || "")) flags.push("extension");
  if (looksExecutable(bytes)) flags.push("binary");
  return { ok: flags.length === 0, flags };
}

function looksExecutable(bytes) {
  if (!bytes || bytes.length < 4) return false;
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return true;
  if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return true;
  if (bytes[0] === 0xca && bytes[1] === 0xfe && bytes[2] === 0xba && bytes[3] === 0xbe) return true;
  if (bytes[0] === 0xcf && bytes[1] === 0xfa && bytes[2] === 0xed && bytes[3] === 0xfe) return true;
  if (bytes[0] === 0xce && bytes[1] === 0xfa && bytes[2] === 0xed && bytes[3] === 0xfe) return true;
  return false;
}
