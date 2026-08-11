# AcoustID test bench

Local only. Ignored by git at the repo root and again here, because it holds an
API key and whatever audio you drop on it.

## Setup

1. `pip install -r requirements.txt`
2. Install **Chromaprint** and put `fpcalc` on PATH (or set `FPCALC_BIN` in `.env`).
   Windows: grab the release zip from https://acoustid.org/chromaprint and unzip it.
3. `cp .env.example .env` and paste your key from https://acoustid.org/new-application
4. `python script/app.py` then open http://127.0.0.1:8077

`/api/health` tells you whether the key and fpcalc are both found.

## How it works

    audio file
      -> fpcalc            fingerprint of the first 120s, computed locally
      -> AcoustID lookup   fingerprint only; the audio never leaves this machine
      -> MusicBrainz ids   title, artist, album, recording id
      -> Cover Art Archive artwork, looked up separately by release-group id

## Things worth knowing before you judge the results

- **AcoustID has no artwork.** Covers come from the Cover Art Archive, so a
  correct match with no image is normal rather than a failure.
- **It matches recordings, not songs.** A different master usually still
  matches. A cover, a live take, a remix, or a song playing behind someone
  talking usually will not.
- **Coverage is community-submitted.** Well-known released music does well;
  obscure, unreleased and user-generated audio mostly returns nothing.
- **It says nothing about licensing.** Identification is not rights data. There
  is no free database that says whether a track is cleared for your platform.
