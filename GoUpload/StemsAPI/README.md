# StemsAPI

Stem separation sidecar for the player's audio visualizer. It splits a track
into drums, bass, other and vocals with Demucs (htdemucs, CPU only) and answers
with energy curves for the kick, snare, hihat, bass and other bands of those
stems. GoUpload turns the curves into `audio_stems.json` and replaces the
instant full mix analysis written during the upload.

It runs after an upload is published, one track at a time, at the lowest CPU
priority, so it never holds up an upload. Only videos the music detector hears
music in are sent, up to 20 minutes long.

## Trust model

- Internal network shared with goupload only: no internet, no Redis, no other
  sidecar. Never published.
- Every request carries `X-Internal-Secret` (`STEMS_API_SECRET`, 32+
  characters). The service refuses to start without it. On the VPS
  `goupload-compose.sh` makes `stems.env` once, root 0600, like `redis.env`.
- The secret is checked before any of the body is read. The body is raw FLAC,
  capped at `STEMS_MAX_UPLOAD_BYTES`, and ffmpeg is told it's FLAC, so a file
  posing as a playlist can't make it open other files or URLs.
- The model weights are pinned by sha256 at build time and checked again
  before loading.
- The answer is band curves, never audio.

## API

`POST /separate`: body is the FLAC file, `Content-Type: audio/flac`, header
`X-Internal-Secret`. Returns:

```json
{ "fps": 43.066406, "duration": 242.3, "frames": 10433,
  "series": { "kick": [], "snare": [], "hihat": [], "bass": [], "other": [] } }
```

401 bad secret, 413 too large, 415 not FLAC, 422 could not decode, 503 with
`Retry-After` when one track is running and `STEMS_MAX_QUEUE` more are waiting.

`GET /health`: liveness and the current inflight count.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `STEMS_THREADS` | 2 | Torch threads. 4 was no faster than 2 in testing. |
| `STEMS_MAX_SECONDS` | 1200 | Audio past this is ignored. |
| `STEMS_MAX_QUEUE` | 2 | Requests that may wait behind the running one. |
| `STEMS_MAX_UPLOAD_BYTES` | 256 MB | Body cap. |

About 1.3x real time on two cores and 1.6 GB of memory at peak, so the compose
limit is 3 GB.

## Backfill

Music published before this service existed only has the instant analysis.
`goupload -backfill-stems` rebuilds each one's audio from its published HLS
audio rendition and queues an ordinary stems job, at most two waiting at a
time so new uploads never queue behind it. It records progress in
`upload/stems-backfill.jsonl` and appends to `upload/stems-backfill.log`, and
a rerun skips what is done, so a deploy restarting the container loses nothing.

```
docker exec goupload /app/goupload -backfill-stems -dry-run
docker exec -d goupload /app/goupload -backfill-stems
docker exec goupload tail -n 20 /app/upload/stems-backfill.log
```

Only one run goes at a time: a second start writes "not starting" to the log
and exits. While this service is down the backfill waits instead of queueing,
since a job queued then would use up its attempts.

`-limit N` stops after N uploads, `-retry-failed` tries earlier failures again,
and `-before` moves the cutoff (default: when this service went live).

## Tests

```
pip install --index-url https://download.pytorch.org/whl/cpu torch==2.15.0
pip install -r requirements.txt pytest
pip install --no-deps -r requirements-ml.txt
pip install cloudpickle==3.1.2 retrying==1.4.2 submitit==1.5.4
python -m pytest tests
```
