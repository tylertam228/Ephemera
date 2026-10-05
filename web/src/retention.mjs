export const presets = [
  ["1m", "1 minute", 60 * 1000],
  ["5m", "5 minutes", 5 * 60 * 1000],
  ["15m", "15 minutes", 15 * 60 * 1000],
  ["1h", "1 hour", 60 * 60 * 1000],
  ["1d", "1 day", 24 * 60 * 60 * 1000],
  ["7d", "7 days", 7 * 24 * 60 * 60 * 1000],
  ["30d", "30 days", 30 * 24 * 60 * 60 * 1000],
];

export function expiry(choice, uploadedAt) {
  if (choice.at != null) {
    if (!Number.isFinite(choice.at) || choice.at <= uploadedAt) return null;
    return choice.at;
  }
  const row = presets.find((item) => item[0] === choice.preset);
  if (!row) return null;
  return uploadedAt + row[2];
}
