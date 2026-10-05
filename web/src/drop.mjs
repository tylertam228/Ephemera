const chunkBytes = 1024 * 1024;
const pinIterations = 600_000;
const info = new TextEncoder().encode("ephemera");

export async function prepareDrop({
  recipients,
  texts,
  files,
  pin = "",
  chunkSize = chunkBytes,
  maxBytes = Number.MAX_SAFE_INTEGER,
}) {
  if (!recipients?.length) throw new Error("no recipient");
  if (chunkSize < 1) throw new Error("chunk");
  const kept = texts.filter((text) => text.trim());
  const plainSize = kept.reduce((sum, text) => sum + text.length, 0) + files.reduce((sum, file) => sum + fileSize(file), 0);
  if (plainSize > maxBytes) failCap();
  const contentKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", contentKey));
  let pinSalt = null;
  let toSeal = raw.slice();
  if (pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await pinKey(pin, salt, ["encrypt"]), raw),
    );
    toSeal = concat([iv, wrapped]);
    pinSalt = bytesToBase64(salt);
  }
  raw.fill(0);
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const ephemeralPublic = new Uint8Array(await crypto.subtle.exportKey("spki", ephemeral.publicKey));
  const keys = [];
  for (const recipient of recipients) {
    keys.push({
      deviceId: recipient.id,
      sealedKey: bytesToBase64(await seal(ephemeral.privateKey, ephemeralPublic, recipient.publicKey, toSeal)),
    });
  }
  const manifest = {
    texts: kept,
    files: files.map((file) => ({
      name: file.name,
      type: file.type || "",
      size: fileSize(file),
      chunks: Math.ceil(fileSize(file) / chunkSize),
    })),
  };
  return { pinSalt, keys, frames: frames(contentKey, manifest, files, chunkSize, maxBytes) };
}

export async function uploadDrop({ senderDeviceId, pinSalt, keys, frames, keepMs, expiresAt }) {
  const meta = { senderDeviceId, pinSalt, keys };
  if (keepMs != null) meta.keepMs = keepMs;
  else meta.expiresAt = expiresAt;
  const parts = [encodePrefix(meta)];
  for (;;) {
    const next = await frames.next();
    if (next.done) break;
    parts.push(next.value);
  }
  const res = await fetch("/api/drops", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: concat(parts),
  });
  if (res.status === 413) failCap();
  if (!res.ok) throw new Error("upload failed");
  return res.json();
}

export function encodePrefix(meta) {
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const out = new Uint8Array(4 + json.length);
  new DataView(out.buffer).setUint32(0, json.length);
  out.set(json, 4);
  return out;
}

export async function openDrop({ privateKey, pin = "", pinSalt, sealedKey, bytes }) {
  const raw = await unseal(privateKey, base64ToBytes(sealedKey), pin, pinSalt);
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
  raw.fill(0);
  const frames = [];
  let offset = 0;
  let index = 0;
  while (offset < bytes.length) {
    if (offset + 16 > bytes.length) throw new Error("truncated");
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
    const len = view.getUint32(0);
    const iv = bytes.subarray(offset + 4, offset + 16);
    const ct = bytes.subarray(offset + 16, offset + 16 + len);
    if (ct.length !== len) throw new Error("truncated");
    const additionalData = new Uint8Array(4);
    new DataView(additionalData.buffer).setUint32(0, index);
    frames.push(
      new Uint8Array(
        await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData }, key, ct),
      ),
    );
    offset += 16 + len;
    index += 1;
  }
  const manifest = JSON.parse(new TextDecoder().decode(frames[0]));
  let cursor = 1;
  const files = manifest.files.map((file) => {
    const parts = frames.slice(cursor, cursor + file.chunks);
    cursor += file.chunks;
    const body = concat(parts);
    if (body.length !== file.size) throw new Error("size");
    return { name: file.name, type: file.type, bytes: body };
  });
  if (cursor !== frames.length) throw new Error("frames");
  return { texts: manifest.texts, files };
}

async function* frames(contentKey, manifest, files, chunkSize, maxBytes) {
  let written = 0;
  const emit = async (index, plain) => {
    const frame = await encryptFrame(contentKey, index, plain);
    written += frame.length;
    if (written > maxBytes) failCap();
    return frame;
  };
  yield await emit(0, new TextEncoder().encode(JSON.stringify(manifest)));
  let index = 1;
  for (const file of files) {
    for await (const plain of plainChunks(file, chunkSize)) {
      yield await emit(index, plain);
      index += 1;
    }
  }
}

async function seal(privateKey, ephemeralPublic, publicKey, bytes) {
  const their = await crypto.subtle.importKey(
    "spki",
    base64ToBytes(publicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: their }, privateKey, 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await hkdf(shared, salt, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, bytes));
  const out = new Uint8Array(1 + salt.length + iv.length + 2 + ephemeralPublic.length + ct.length);
  out[0] = 1;
  out.set(salt, 1);
  out.set(iv, 17);
  new DataView(out.buffer).setUint16(29, ephemeralPublic.length);
  out.set(ephemeralPublic, 31);
  out.set(ct, 31 + ephemeralPublic.length);
  return out;
}

async function unseal(privateKey, bytes, pin, pinSalt) {
  if (bytes[0] !== 1 || bytes.length < 47) throw new Error("sealed");
  const salt = bytes.subarray(1, 17);
  const iv = bytes.subarray(17, 29);
  const ephLen = new DataView(bytes.buffer, bytes.byteOffset + 29, 2).getUint16(0);
  const ephPub = bytes.subarray(31, 31 + ephLen);
  const ct = bytes.subarray(31 + ephLen);
  if (ephLen < 50 || !ct.length) throw new Error("sealed");
  const their = await crypto.subtle.importKey("spki", ephPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: their }, privateKey, 256);
  const aes = await hkdf(shared, salt, ["decrypt"]);
  const opened = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aes, ct));
  if (!pinSalt) return opened;
  if (!pin || opened.length < 28) throw new Error("pin");
  const pinAes = await pinKey(pin, base64ToBytes(pinSalt), ["decrypt"]);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: opened.subarray(0, 12) },
      pinAes,
      opened.subarray(12),
    ),
  );
}

async function hkdf(shared, salt, usages) {
  const base = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

async function pinKey(pin, salt, usages) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: pinIterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

async function encryptFrame(key, index, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new Uint8Array(4);
  new DataView(additionalData.buffer).setUint32(0, index);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key, plain));
  const out = new Uint8Array(4 + iv.length + ct.length);
  new DataView(out.buffer).setUint32(0, ct.length);
  out.set(iv, 4);
  out.set(ct, 16);
  return out;
}

async function* plainChunks(file, chunkSize) {
  const size = fileSize(file);
  if (file.bytes) {
    for (let offset = 0; offset < size; offset += chunkSize) {
      yield file.bytes.subarray(offset, Math.min(offset + chunkSize, size));
    }
    return;
  }
  for (let offset = 0; offset < size; offset += chunkSize) {
    yield new Uint8Array(await file.slice(offset, Math.min(offset + chunkSize, size)).arrayBuffer());
  }
}

function fileSize(file) {
  return file.bytes ? file.bytes.byteLength : file.size;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function failCap() {
  throw Object.assign(new Error("too large"), { code: "cap" });
}
