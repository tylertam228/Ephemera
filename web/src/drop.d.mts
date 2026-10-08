export function prepareDrop(input: {
  recipients: { id: string; publicKey: string }[];
  texts: string[];
  files: { name: string; type: string; size: number; slice: (start: number, end: number) => Blob }[];
  chunkSize?: number;
  maxBytes?: number;
}): Promise<{
  keys: { deviceId: string; sealedKey: string }[];
  frames: AsyncGenerator<Uint8Array>;
}>;

export function uploadDrop(input: {
  senderDeviceId: string;
  keys: { deviceId: string; sealedKey: string }[];
  frames: AsyncGenerator<Uint8Array>;
  keepMs?: number;
  expiresAt?: number;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<{ id: string; expiresAt: number }>;

export function encodePrefix(meta: unknown): Uint8Array;

export function openDrop(input: {
  privateKey: CryptoKey;
  sealedKey: string;
  bytes: Uint8Array;
}): Promise<{ texts: string[]; files: { name: string; type: string; bytes: Uint8Array }[] }>;
