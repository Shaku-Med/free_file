# LoadPlay

Tiny CDN-style service that fronts HLS playback. Sits on `:3006`.

## What it does

1. Validates HMAC-signed playback tokens minted by the main app.
2. Fetches HLS `.m3u8` manifests from backing storage and rewrites every
   segment / sub-playlist URI to stay on this service (`/v/...?t=`).
3. **Proxies** segment bytes (`.ts`, `.m4s`, …) after token validation.
   Backing storage URLs are server-side only — clients never see GitHub
   or repo paths.

## Routes

| Method | Path                       | What it does                                  |
| ------ | -------------------------- | --------------------------------------------- |
| GET    | `/health`                  | `{ ok: true }`                                |
| GET    | `/v/:fileId/<...>`         | Manifest if `.m3u8`, otherwise segment.       |

All `/v/...` routes require `?t=<playback-token>` (HMAC, short expiry).

## Env

| Name                    | Required | Default | Purpose                                                     |
| ----------------------- | -------- | ------- | ----------------------------------------------------------- |
| `PLAYBACK_TOKEN_SECRET` | yes      | —       | Shared HMAC secret with the main app                        |
| `GITHUB_OWNER`          | yes      | —       | Storage repo owner                                          |
| `GITHUB_REPO`           | yes      | —       | Storage repo name                                           |
| `GITHUB_BRANCH`         | no       | `main`  | Storage repo branch                                         |
| `PORT`                  | no       | `3006`  | Listen port                                                 |
| `ALLOWED_ORIGINS`       | no       | empty   | CSV of Origin / Referer values for the soft hot-link gate   |
| `REQUIRE_FINGERPRINT`   | no       | `0`     | `1` to enforce IP/UA hashes embedded in the token           |
| `BLOCK_TOOL_UA`         | no       | `1`     | `0` to allow curl/Postman/etc UAs through                   |

## Token format

JWT-compact-shaped, fixed algorithm (HMAC-SHA256). Two base64url
segments joined by `.`:

```
base64url(json_payload).base64url(hmac_sha256(secret, base64url(json_payload)))
```

Payload schema:

```json
{
  "f": "<file id>",
  "u": "<user id, optional>",
  "p": "<storage path relative to repo root, e.g. 19_05_2026/abc/master.m3u8>",
  "e": <unix ms expiry>,
  "i": "<base64url(sha256(ip /24 or /64))>, optional>",
  "a": "<base64url(sha256(user-agent))>, optional>",
  "n": "<one-time nonce, optional>"
}
```

The main app should mint these in `/api/views/watch-issue`. CDN
re-derives signature with its copy of the secret, no DB lookup.

## Local dev

```
cd GoUpload/LoadPlay
air        # hot reload via tmp/loadplay.exe
```

## Production

Build context is the `GoUpload/` root because LoadPlay shares its
`go.mod` with the upload server (zero code duplication for `lib/env`,
`lib/logger`).

```
docker build -t loadplay -f LoadPlay/Dockerfile .
docker run -p 3006:3006 \
  -e PLAYBACK_TOKEN_SECRET=... \
  -e GITHUB_OWNER=... \
  -e GITHUB_REPO=... \
  -e ALLOWED_ORIGINS="https://memories.brozy.org" \
  loadplay
```

## Security notes (per `.ainotes/ToKnow.md`)

- No secrets in source. `PLAYBACK_TOKEN_SECRET`, `GITHUB_OWNER`,
  `GITHUB_REPO` all come from env. Service refuses to start without
  the required ones.
- HMAC compared with `hmac.Equal` (constant-time).
- Errors never returned verbatim in HTTP responses — generic
  `"Something's wrong."` body, real reason only in server logs.
- Path traversal guarded in `storage.PathFor`.
- Same-folder constraint on segment paths so a token for file A can't
  pull from file B's folder even with a path-traversal-free relative
  path.
- Fingerprint binding (IP /24 + UA hash) is optional but supported —
  flip `REQUIRE_FINGERPRINT=1` once the app side emits matching hashes.

## Tests

```
cd GoUpload
go test ./LoadPlay/...
```

Covers token round-trip, wrong-secret rejection, tampered payload
rejection, expiry, and malformed inputs.
