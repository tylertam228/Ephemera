const dbName = "ephemera";
const storeName = "device";

export type LocalDevice = {
  userId: string;
  deviceId: string;
  name: string;
  publicKey: string;
};

type StoredDevice = LocalDevice & {
  privateKey: CryptoKey;
  publicCryptoKey: CryptoKey;
};

export async function loadDevice(userId: string): Promise<LocalDevice | null> {
  const row = await read(userId);
  if (!row?.deviceId || !row.privateKey) return null;
  return { userId, deviceId: row.deviceId, name: row.name, publicKey: row.publicKey };
}

export async function createDevice(userId: string, name: string): Promise<LocalDevice> {
  const existing = await read(userId);
  const pair = existing?.privateKey
    ? { privateKey: existing.privateKey, publicKey: existing.publicCryptoKey }
    : await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const publicKey =
    existing?.publicKey ??
    bytesToBase64(await crypto.subtle.exportKey("spki", pair.publicKey));
  await write({
    userId,
    deviceId: existing?.deviceId ?? "",
    name,
    publicKey,
    privateKey: pair.privateKey,
    publicCryptoKey: pair.publicKey,
  });
  const res = await fetch("/api/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, publicKey }),
  });
  if (!res.ok) throw new Error("device rejected");
  const saved = (await res.json()) as { id: string; name: string };
  const row = {
    userId,
    deviceId: saved.id,
    name: saved.name,
    publicKey,
    privateKey: pair.privateKey,
    publicCryptoKey: pair.publicKey,
  };
  await write(row);
  return { userId, deviceId: row.deviceId, name: row.name, publicKey };
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function read(userId: string): Promise<StoredDevice | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).get(userId);
    const row = await new Promise<StoredDevice | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await done(tx);
    return row;
  } finally {
    db.close();
  }
}

async function write(row: StoredDevice): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(row, row.userId);
    await done(tx);
  } finally {
    db.close();
  }
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
