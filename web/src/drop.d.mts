export function prepareDrop(input: {
  recipients: { id: string; publicKey: string }[];
  texts: string[];
  files: { name: string; type: string; size: number; slice: (start: number, end: number) => Blob }[];
  pin?: string;
  chunkSize?: number;
  maxBytes?: number;
}): Promise<{
  pinSalt: string | null;
  keys: { deviceId: string; sealedKey: string }[];
  frames: AsyncGenerator<Uint8Array>;
}>;

export function uploadDrop(input: {
  pinSalt: string | null;
  keys: { deviceId: string; sealedKey: string }[];
  frames: AsyncGenerator<Uint8Array>;
  keepMs?: number;
  expiresAt?: number;
}): Promise<{ id: string; expiresAt: number }>;

export function encodePrefix(meta: unknown): Uint8Array;

export function openDrop(input: {
  privateKey: CryptoKey;
  pin?: string;
  pinSalt: string | null;
  sealedKey: string;
  bytes: Uint8Array;
}): Promise<{ texts: string[]; files: { name: string; type: string; bytes: Uint8Array }[] }>;
