# Ephemera

Version 1 is a burn-after-reading drop for text and files. Two machines that cannot reach each other directly both open this site, sign in with the same Discord account, and hand the payload across. The server stores ciphertext only. A drop is deleted when a recipient takes it or when its timer expires. There is no content backup.

The application is not implemented yet. This document defines the version 1 scope, the encryption flow, and the local Discord setup.

## Scope

- Any Discord account can sign in. A drop belongs to that account. Another account cannot open it.
- The first sign-in in a browser creates a device key pair. The private key stays in that browser. The public key is uploaded. The user names the device, for example Desktop or Mac.
- One drop holds multiple text blocks and multiple files of any type. Filenames and contents are encrypted before upload.
- The default recipients are the account's other devices. Sending is blocked until a second device has signed in and registered a public key.
- Retention defaults to 1 minute and starts when the upload completes. The sender picks a preset or an exact expiry on a date-and-time picker. Presets are 1 minute, 5 minutes, 15 minutes, 1 hour, 1 day, 7 days, and 30 days. There is no maximum.
- A PIN is optional. When set, the receiving browser must enter it before decryption. The PIN is derived in the browser and is never sent to the server.
- A successful decrypt is the claim. The server then deletes the drop for every targeted device. Expiry deletes it as well. A wrong PIN does not delete the drop; the recipient can retry until expiry.
- After decrypt, the recipient gets a review screen and nothing is saved automatically. Each text block is shown in full with a Copy button. Each file is listed with its filename and type, plus a Download button. Copy and download are optional. Closing the page discards whatever is still only in the browser. File bytes are not rendered inline.
- Files are encrypted in chunks. The server cap is `MAX_UPLOAD_MB`, default 1024 (1GB per drop). The operator can raise or lower it. The cap protects disk space.

The server keeps ciphertext, the content key sealed for each target device, the expiry time, and the public salt used for a PIN. Plaintext, the content key, the PIN, and device private keys stay in the browser.

## Example workflow

Device A and Device B below are any two browsers signed in to the same Discord account. The sender and the recipient can be a phone, a laptop, or a desktop. The platform does not matter.

```mermaid
sequenceDiagram
  participant DeviceA as Device A
  participant Server
  participant DeviceB as Device B
  DeviceA->>Server: Sign in with Discord and register public key
  DeviceB->>Server: Sign in with Discord and register public key
  DeviceA->>DeviceA: Encrypt the drop with a random content key
  DeviceA->>DeviceA: Optionally wrap that key with a PIN
  DeviceA->>DeviceA: Seal the key to the Device B public key
  DeviceA->>Server: Upload ciphertext, sealed key, and expiry
  DeviceB->>Server: Load the inbox
  DeviceB->>DeviceB: Decrypt with the private key and PIN if required
  DeviceB->>Server: Confirm the claim
  Server->>Server: Delete ciphertext and records
  DeviceB->>DeviceB: Review text with Copy, and files with name, type, and Download
```

Clearing site data, or switching browsers, destroys that device's private key. Drops already sealed for it can no longer be opened. They disappear when they expire.

## Out of scope

- Teams, fan-out to several people, and deletion only after every recipient has claimed the drop
- Claim links for someone who is not signed in
- An account allowlist
- File-type restrictions or virus scanning

The data model will keep a recipient list so a later version can seal a drop to selected members and delete it only after every member has claimed it.

## Environment

Copy this block into `.env`. That file is gitignored and must stay untracked.

```
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_PUBLIC_KEY=
AUTH_URL=http://localhost:3000
MAX_UPLOAD_MB=1024
```

| Variable | Source |
| --- | --- |
| `DISCORD_CLIENT_ID` | OAuth2 Client ID. It is the same value as the Application ID. |
| `DISCORD_CLIENT_SECRET` | OAuth2 Client Secret. |
| `DISCORD_PUBLIC_KEY` | Application public key. Version 1 stores it and does not read it during sign-in or transfer. |
| `AUTH_URL` | Public origin of this site. Local: `http://localhost:3000`. VPS: `https://your.domain`. |
| `MAX_UPLOAD_MB` | Maximum drop size in megabytes. Default `1024`. |

Sign-in is Discord OAuth2 with the `identify` scope only. Do not add a Bot to this application. Leave the OAuth2 URL Generator unused; the site builds the authorize URL itself.

## Local Discord redirect

In the Developer Portal, open the application, then OAuth2, then Redirects. Add the URL below and save. The value must match exactly.

```
http://localhost:3000/api/auth/callback/discord
```

When the same application is used on the VPS, add a second redirect and set `AUTH_URL` on that host to the same origin. The client ID and client secret stay unchanged.

```
https://your.domain/api/auth/callback/discord
```

## Deployment

Version 1 runs on a private VPS. The planned stack is Next.js, Better Auth, SQLite for metadata, a local directory for ciphertext, and Docker Compose with Caddy for HTTPS.

Leave provider-wide disk snapshots off for the data volume. A snapshot would retain ciphertext after a claim. That ciphertext is still unreadable without the recipient's private key, and it breaks the requirement that a taken drop leave no copy on disk.
