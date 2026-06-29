# MusicDetector

Local music/speech classifier sidecar. Decides `files.is_music` from how much of
a track is actually music, so clips with only background music under speech stop
getting fingerprinted and tagged. AcoustID stays for song metadata; this service
only makes the is_music call and never touches the DB.

Same trust model as EmbedAPI: private docker network, no published port, every
request carries `X-Internal-Secret`. GoUpload is the only caller.

## API

`POST /analyze` — multipart `file` (audio or any media ffmpeg can read), header
`X-Internal-Secret`. Returns:

```json
{
  "is_music": true,
  "music_seconds": 145.3,
  "speech_seconds": 12.0,
  "voiced_seconds": 157.3,
  "analyzed_seconds": 178.0,
  "music_ratio": 0.9237,
  "threshold": 0.5,
  "min_music_seconds": 15.0
}
```

`is_music = music_ratio >= threshold AND music_seconds >= min_music_seconds`.
Silence is excluded from the ratio. Only the first `MUSIC_ANALYZE_MAX_SECONDS`
are analyzed. Returns `503 Retry-After` when the queue is full.

`GET /health` — liveness + current inflight count.

## Load control

`MUSIC_CONCURRENCY` analyses run at once; up to `MUSIC_MAX_QUEUE` more wait;
anything beyond gets a 503 so the box never floods. `MUSIC_THREADS` caps TF/BLAS
cores per analysis. Defaults (1 / 8 / 1) suit a small shared VPS.

## Layout

```
src/    analyzer.py (logic + model), main.py (FastAPI app)
tests/  test_analyzer.py (pure-logic, no TensorFlow)
```

## Dependencies

- `requirements.txt` — API libs only (FastAPI etc.), install anywhere.
- `requirements-ml.txt` — TensorFlow + inaSpeechSegmenter, Docker image only (TF 2.15
  has no Python 3.13 / Windows build). The Dockerfile installs both.
- `requirements-dev.txt` — `requirements.txt` + pytest, for running the tests.

## Run

```bash
# tests (pure logic; pytest.ini puts src/ on the path). Use `python -m pytest`
# so it works even when the pip --user Scripts dir isn't on PATH (common on Windows).
pip install -r requirements-dev.txt
python -m pytest -q

# dev server, no docker needed: boots in STUB mode (fake is_music) when the ML
# stack isn't installed, so you can develop the API/auth/queue. /health shows
# "stub": true. Needs MUSIC_API_SECRET set (a .env beside this README works).
python src/main.py

# production image (real detection; installs the ML stack on Python 3.11)
docker build -t musicdetector .
```

In production compose sets `MUSIC_ALLOW_STUB=0`, so if the model fails to load the
service errors out instead of silently faking results.

Tune thresholds with a handful of real uploads before trusting it.
