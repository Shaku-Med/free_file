# Livestream — Memories

> This feature is currently under development and has not been deployed yet.

---

## Overview

Memories will support live streaming directly on the platform. Users can go live from any device, viewers can watch in real time, chat, and catch up on anything they missed.

---

## Two Ways to Go Live

### IRL Mode
For streamers using OBS or a dedicated streaming app. Pushes to the server over RTMP. Better for high quality setups or anyone who wants more control over their stream.

### Browser / Device Mode
Go live straight from your browser or phone with no external app. Uses WebRTC so your camera and mic stream directly to the server with minimal setup.

---

## What's Being Built

- **DVR / Catch-up** — viewers can rewind and jump back to live at any point during an active stream
- **Live chat** — realtime chat using Supabase Realtime
- **Viewer count** — updates live as people join and leave
- **Moderation** — automated checks on video frames, audio transcription for harmful speech, chat filtering, and a strike system for repeat violations
- **Ban system** — stream-level and platform-level bans, temporary or permanent
- **Captions** — auto-generated via Whisper, defaults to the viewer's region language, switchable anytime

---

## Tech Stack

| Layer | Technology |
|---|---|
| Stream ingestion | MediaMTX (RTMP + WebRTC/WHIP) |
| Stream server | Go |
| Moderation worker | Python / FastAPI |
| Speech-to-text | Whisper (local) |
| Video playback | HLS.js |

---

## Status

| Component | Status |
|---|---|
| Go server scaffolding | In progress |
| RTMP stream auth | In progress |
| WebRTC / WHIP support | In progress |
| DVR / catch-up | Planned |
| Live chat | Planned |
| Moderation pipeline | Planned |
| Caption generation | Planned |
| Frontend player | Planned |