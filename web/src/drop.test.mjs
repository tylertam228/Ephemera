import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { openDrop, prepareDrop, uploadDrop } from "./drop.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

async function person() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = Buffer.from(await crypto.subtle.exportKey("spki", pair.publicKey)).toString("base64");
  return { privateKey: pair.privateKey, publicKey };
}

function concat(parts) {
  return new Uint8Array(Buffer.concat(parts.map((part) => Buffer.from(part))));
}

test("a drop seals to each recipient and a wrong PIN does not open it", async () => {
  const ada = await person();
  const phone = await person();
  const stranger = await person();
  const file = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const prepared = await prepareDrop({
    recipients: [
      { id: "a".repeat(32), publicKey: ada.publicKey },
      { id: "b".repeat(32), publicKey: phone.publicKey },
    ],
    texts: ["", "hello secret"],
    files: [{ name: "note.txt", type: "text/plain", bytes: file }],
    pin: "9481",
    chunkSize: 4,
  });
  const frames = [];
  for await (const frame of prepared.frames) frames.push(frame);
  assert.equal(frames.length, 1 + Math.ceil(file.length / 4));
  const bytes = concat(frames);
  assert.equal(Buffer.from(bytes).includes("hello secret"), false);
  assert.equal(Buffer.from(bytes).includes("note.txt"), false);
  assert.equal(prepared.keys.map((key) => key.deviceId).join(), `${"a".repeat(32)},${"b".repeat(32)}`);
  const opened = await openDrop({
    privateKey: phone.privateKey,
    pin: "9481",
    pinSalt: prepared.pinSalt,
    sealedKey: prepared.keys[1].sealedKey,
    bytes,
  });
  assert.deepEqual(opened.texts, ["hello secret"]);
  assert.equal(opened.files[0].name, "note.txt");
  assert.equal(opened.files[0].type, "text/plain");
  assert.deepEqual(opened.files[0].bytes, file);
  await assert.rejects(() =>
    openDrop({
      privateKey: phone.privateKey,
      pin: "nope",
      pinSalt: prepared.pinSalt,
      sealedKey: prepared.keys[1].sealedKey,
      bytes,
    }),
  );
  await assert.rejects(() =>
    openDrop({
      privateKey: stranger.privateKey,
      pin: "9481",
      pinSalt: prepared.pinSalt,
      sealedKey: prepared.keys[1].sealedKey,
      bytes,
    }),
  );

  const plain = await prepareDrop({
    recipients: [{ id: "a".repeat(32), publicKey: ada.publicKey }],
    texts: ["open"],
    files: [],
  });
  assert.equal(plain.pinSalt, null);
  const plainFrames = [];
  for await (const frame of plain.frames) plainFrames.push(frame);
  const read = await openDrop({
    privateKey: ada.privateKey,
    pinSalt: null,
    sealedKey: plain.keys[0].sealedKey,
    bytes: concat(plainFrames),
  });
  assert.deepEqual(read.texts, ["open"]);
  assert.deepEqual(read.files, []);
});

test("a browser File is encrypted from its contents", async () => {
  const ada = await person();
  const payload = new Uint8Array([1, 2, 3, 4, 5]);
  const file = new File([payload], "pic.bin", { type: "application/octet-stream" });
  assert.equal(typeof file.bytes, "function");
  const prepared = await prepareDrop({
    recipients: [{ id: "a".repeat(32), publicKey: ada.publicKey }],
    texts: [],
    files: [file],
    chunkSize: 2,
  });
  const frames = [];
  for await (const frame of prepared.frames) frames.push(frame);
  assert.equal(frames.length, 1 + Math.ceil(payload.length / 2));
  const opened = await openDrop({
    privateKey: ada.privateKey,
    pinSalt: null,
    sealedKey: prepared.keys[0].sealedKey,
    bytes: concat(frames),
  });
  assert.equal(opened.files[0].name, "pic.bin");
  assert.deepEqual(opened.files[0].bytes, payload);
});

test("upload posts the ciphertext as one buffer", async () => {
  const ada = await person();
  const prepared = await prepareDrop({
    recipients: [{ id: "a".repeat(32), publicKey: ada.publicKey }],
    texts: ["open"],
    files: [],
  });
  let body;
  const previous = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    body = init.body;
    return new Response(JSON.stringify({ id: "d".repeat(32), expiresAt: 1 }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const saved = await uploadDrop({
      senderDeviceId: "f".repeat(32),
      pinSalt: prepared.pinSalt,
      keys: prepared.keys,
      frames: prepared.frames,
      keepMs: 60_000,
    });
    assert.equal(saved.id, "d".repeat(32));
  } finally {
    globalThis.fetch = previous;
  }
  assert.ok(body instanceof Uint8Array);
  assert.equal(body.byteLength > 4, true);
  const jsonLength = new DataView(body.buffer, body.byteOffset, 4).getUint32(0);
  const meta = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + jsonLength)));
  assert.equal(meta.senderDeviceId, "f".repeat(32));
});
