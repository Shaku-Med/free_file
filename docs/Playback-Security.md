# Playback security: what the token actually protects

Status: accurate as of the pace limiter change.

I wrote this because the playback protections were being trusted for something
they don't do. Short version: the current design stops people sharing URLs. It
does not stop someone downloading the video on their own machine, and it can't.

---

## The "one time key" is not one time

The name is misleading and that matters.

`internal/noncestore` ties a token's nonce to the first fingerprint that uses
it, then lets that same fingerprint reuse it as much as it likes until the TTL
runs out:

```go
if e, ok := s.items[nonce]; ok {
    return e.fingerprint == fingerprint   // same client, allowed again
}
```

That behaviour is on purpose and it has to be. HLS playback needs one token to
pull a manifest plus hundreds of segments, so a key that really was single use
would kill playback after the first request.

What you get from it is replay binding. Paste the URL into another browser,
another machine, or send it to a friend, and the fingerprint won't match, so
it gets refused.

What you don't get is any protection from a second process on the same machine
presenting the same fingerprint.

---

## Why ffmpeg works on one browser and fails on another

The fingerprint gets built in `internal/handler/security.go`:

| Part | Where it comes from | Can the client fake it? |
| --- | --- | --- |
| IP bucket | socket / XFF | Same machine, so it's identical anyway |
| UA bucket | `User-Agent` header | Yes, any HTTP client sets it |
| Shape bucket | `Sec-Fetch-Mode` / `-Site` / `-Dest` | Yes, they're just headers |
| Shape bucket | whether `X-App-Origin` is set | Yes, also just a header |

Every part is either a header the client picks or an IP shared by everything on
the machine. So any tool that copies the browser's headers rebuilds the
fingerprint exactly.

That is what a capture extension does. Straight out of `hls-downloader`'s own
`background.js`:

```js
const allow = new Set([
  'authorization', 'cookie', 'referer', 'origin',
  'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest',
  ...
]);
```

It grabs those through `chrome.webRequest.onBeforeSendHeaders` and passes them
to ffmpeg, which replays them (`host.py`, `build_ffmpeg_header_block`). The
comment there even says to match the browser request as closely as possible,
because CDNs return 403 when the headers don't line up.

That captured set covers everything the fingerprint hashes except
`X-App-Origin`. So the download goes through.

The difference between browsers is not a security boundary. It comes down to
whether that browser's extension managed to capture headers on that request.
Brave's shields and its `extraHeaders` behaviour get in the way, Edge's don't.
Reading "it failed on Brave" as protection is reading luck as design. Fix the
capture on Brave and it works there too.

`X-App-Origin` not being copied isn't a defence either. It's one line for
anyone who spots it, so it isn't listed here as a mitigation.

---

## The pace limiter (what changed)

The old ceiling was 150 segments per 45s, which works out to 3.3 segments a
second sustained. A real viewer needs about 0.33 a second (video plus audio at
roughly 6s segments). That 10x gap meant a ripper could run flat out and never
come close to the limit, which is the answer to "the user has no limit, what's
wrong?"

There was a limit. It was just set about 10x too high to do anything.

It's now a token bucket in `internal/ratelimit`:

- burst of 60 segments, so startup prefetch and a dozen or so seeks never stall
- refill of 1.0 a second, roughly 3x what a real viewer needs and 3.3x tighter
  than the old sustained ceiling

The sliding window stays as a hard ceiling on top, and both have to allow a
request.

This works because the two kinds of traffic have different shapes. Playback is
bursty with a low average: a startup buffer, then quiet stretches, then a spike
on each seek. Ripping is a flat out sustained pull. Cutting the sustained rate
turns a 30 second grab of a 10 minute video into something much closer to real
time.

It's friction, not prevention. A downloader that paces itself to real time
still walks through. That's a known limit of the approach, not something I
missed.

---

## The bit that can't be fixed without DRM

If the browser can decode and show the frames, software running as or next to
that browser can capture them. Every signal the server can check (headers,
cookies, IP, request shape) is available to that software by definition.

The only thing that changes this is DRM (Widevine, FairPlay, PlayReady) through
EME, where decryption happens somewhere the page itself can't read. That was
looked at and turned down on cost, see the DRM decision. Screen recording still
beats even that.

So the honest position is:

| Threat | Where we stand |
| --- | --- |
| Sharing a playback URL | Stopped, via nonce fingerprint binding |
| Hotlinking or embedding elsewhere | Stopped, via origin and context checks |
| Expired or forged token | Stopped, via HMAC and TTL |
| Restricted account's content | Stopped, owner status checked in both layers |
| Casual right click or devtools save | Stopped, there's no progressive URL, HLS only |
| Local extension plus ffmpeg with copied headers | Slowed down, not stopped |
| Screen recording | Nothing to be done |

If something claims a stronger position than this table, it's wrong.

---

## Downloads

Separate from all of the above: the `/api/download*` routes are sealed for
everyone including owners (`lib/Security/downloadPolicy.server.ts`, 410 Gone).
The queue service and the button component are kept on purpose for the
authenticated download flow that's coming later. Only the routes are
unreachable.

Worth saying clearly: those endpoints were never the leak. They were owner
gated and the extension never touched them. It reads the HLS stream, same as
any player would.
