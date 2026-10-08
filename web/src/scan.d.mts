export function scanFile(input: {
  name: string;
  bytes: Uint8Array;
}): { ok: boolean; flags: string[] };
