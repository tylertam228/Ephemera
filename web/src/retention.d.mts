export const presets: readonly (readonly [string, string, number])[];

export function expiry(
  choice: { preset: string; at: number | null },
  uploadedAt: number,
): number | null;
