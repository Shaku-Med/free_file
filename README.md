# Memories

Fork this repo and run your own YouTube style video platform. Memories is made
of a web app and a few small services that handle uploads and streaming. This
README gets the whole thing running and explains how the pieces fit together.

Take it one section at a time. You can have the web app up and clickable in a few
minutes, then wire in uploads and playback when you are ready.

## What is in this repo

- `app` is the web app itself: the watch pages, the reels, the studio and every
  API route the site runs on. It is built with React Router 7, TypeScript and
  Supabase. This is the main thing you run, and most of this guide is about it.
- `GoUpload` is the Go service that takes a raw upload and processes it into the
  streamable HLS format, makes thumbnails and so on.
- `GoUpload/loadplay` serves the HLS video with signed playback tokens so the
  files are not hot linked.
- `GoUpload/NSFWAPI` scores images for adult content and gore. Gore the vision
  model confirms is refused, other violent content stays private until someone
  reviews it, and adult files are kept but unlisted.
- `GoUpload/EmbedAPI` turns text into vectors so search can find similar videos.
- `mobile`, `livestream`, `windapp` and `LoadNodeServer` are supporting or
  experimental pieces. Each lives in its own folder.

You do not need every service just to look around. The web app boots on its own.
You only need GoUpload and loadplay once you want real uploads and playback to
work from end to end.

## Running the web app

Everything in this section happens inside the `app` folder.

### What you need first

- Node 20 and npm.
- A Supabase project (the free tier is plenty to start). You get the database
  and a service role key from there.
- Somewhere to store uploads later: Cloudflare R2, GitHub, or both. You can skip
  this until you want uploads working.

### Step 1. Install

```bash
cd app
npm install
```

The project pins `legacy-peer-deps` in `.npmrc`, so installs stay consistent. No
extra flags needed.

### Step 2. Set up the database

All of the SQL lives in `app/database`, split into three groups. Run them in this
order, because the tables have to exist before the functions that read them.

1. `app/database/default-schemas` first. These create the core tables: users,
   files, comments, likes, playlists, notifications, series and so on.
2. `app/database/migrations` next. These add columns and features on top of the
   base tables over time.
3. `app/database/V2` last. These are the stored functions that power the smart
   feed, the reels, search, suggestions and the rest.

Skip the `legacy` folders inside `migrations` and `V2`. Those are older versions
that have been replaced.

The easiest way is to open the SQL editor in your Supabase dashboard and paste in
each file, one folder at a time, top to bottom. Most files are safe to run again,
so a rerun will not break anything.

If you would rather use the command line and you have `psql` plus your database
connection string, you can loop through a folder like this:

```bash
for f in app/database/default-schemas/*.sql; do psql "$DATABASE_URL" -f "$f"; done
for f in app/database/migrations/*.sql;      do psql "$DATABASE_URL" -f "$f"; done
for f in app/database/V2/*.sql;              do psql "$DATABASE_URL" -f "$f"; done
```

That leaves the `legacy` subfolders alone, since the glob only picks up files
sitting directly in each folder.

### Step 3. Set up your environment

```bash
cd app
cp .env.example .env
```

Open `.env` and read the comments. Every value is grouped and explained there.
The short version:

- The one thing the app cannot start without is the Supabase pair, `SUPABASE_URL`
  and `SUPABASE_ANON_KEY`. One heads up on naming: the variable is called
  `SUPABASE_ANON_KEY` for historical reasons, but you put your **service role**
  key in it, not the public anon key. The server uses it to reach the database
  with full rights and scopes every query to the signed in user in code.
- The signing secrets, like `REQUEST_SIG_SECRET` and `SEGMENT_TOKEN_SECRET`,
  should be long random strings. Make one with `openssl rand -base64 48`. If you
  leave them blank the app refuses to sign tokens with an empty key, on purpose.
- Storage, email, uploads and passkeys are optional to begin with. Fill them in
  as you turn each feature on.

There is a second env file, `app/.env.notification`, that holds the push
notification keys. You do not create it yourself. The build step writes a fresh
key pair into it the first time, then leaves it alone so existing subscriptions
keep working. The app loads both `.env` and `.env.notification` when it starts.

### Step 4. Run it

For day to day development with hot reload:

```bash
cd app
npm run dev
```

To build once and run the production server the way it runs when deployed:

```bash
cd app
npm run build
npm run start
```

Either way the app comes up on `http://localhost:3000` unless you set a different
`PORT`.

### Running the web app with Docker instead

There is a Dockerfile and a compose file in `app`. With your `.env` and
`.env.notification` next to the compose file:

```bash
cd app
docker compose up -d --build
docker compose logs -f app
```

The image builds the app and serves it on port 3000, with your secrets mounted in
at run time rather than baked into the image.

### Handy commands (run inside `app`)

```bash
npm run dev         # start the dev server with hot reload
npm run build       # build the production bundle
npm run start       # run the built app
npm run typecheck   # generate route types and run the TypeScript checker
```

## Running the upload and streaming services

These are what make real uploads and playback work. Each one lives in its own
folder and reads its own `.env` from that folder. Copy each `.env.example` to
`.env` and fill it in before you start the service.

What you need installed for these:

- Go 1.24 or newer and ffmpeg on your PATH, for GoUpload and loadplay.
- Node 20, for NSFWAPI.
- Python 3.10 or newer, for EmbedAPI.

A note on Docker: the `GoUpload/docker-compose.yml` pulls prebuilt images from a
registry, so it is meant for deployment, not for running from source on your
machine. To run locally, start each service directly as shown below, or build
each folder's Dockerfile yourself.

A quick map of the ports so nothing collides: GoUpload 3003, NSFWAPI 3004,
loadplay 3006, EmbedAPI 3007. The web app sits on 3000.

### GoUpload (upload processing)

This takes the raw upload and turns it into streamable HLS, makes thumbnails and
runs the checks. It needs ffmpeg on your PATH.

```bash
cd GoUpload
cp .env.example .env     # then fill it in
go run .
```

It listens on port 3003 (`PORT`). It calls NSFWAPI for adult content checks, so
start that one too if you want them.

### loadplay (video streaming)

This serves the HLS video with signed playback tokens.

```bash
cd GoUpload/loadplay
cp .env.example .env     # then fill it in
go run .
```

It listens on port 3006 (`PORT`). Its `PLAYBACK_TOKEN_SECRET` must match the
app's `SEGMENT_TOKEN_SECRET`, otherwise a token the app mints will not validate
here.

### NSFWAPI (adult content and gore scoring)

```bash
cd GoUpload/NSFWAPI
cp .env.example .env     # add a Groq or Google Cloud Vision key
npm install
npm run dev              # or for production: npm run build && npm run start
```

It listens on port 3004 (`NSFW_API_PORT`). It needs a Google Cloud Vision key
to score anything; the Groq key adds captions and the gore check, and without it
a gory upload stays private for review instead of being refused.

### EmbedAPI (search vectors, optional)

This turns text into vectors so search can find similar videos. You can skip it
to start.

```bash
cd GoUpload/EmbedAPI
pip install -r requirements.txt
python main.py
```

It listens on port 3007 (`EMBED_API_PORT`) and reads its config from a `.env` in
this folder. The one required value is `EMBED_API_SECRET`, which has to match the
value the app and GoUpload use to call it. It refuses to start without that
secret. You can also set `EMBED_MODEL` and `EMBED_THREADS`, but the defaults are
fine.

### Wiring the services back to the app

In the app's `.env`, point `UPLOAD_SERVER_URL` and `GO_UPLOAD_URL` at GoUpload,
and `LOADPLAY_BASE_URL` at loadplay. The `UPLOAD_WEBHOOK_SECRET` has to be the
same value on both the app and GoUpload. With the defaults above that means
GoUpload on `http://localhost:3003` and loadplay on `http://localhost:3006`.

## How the web app is laid out

A quick map so you know where to look:

- `app/routes` is every page and API endpoint.
- `app/components` is the shared UI, including the video player under
  `components/components/hlsplayer`.
- `app/lib` is the shared logic: the Supabase client, security helpers, services
  and small utilities.
- `app/database` is all of the SQL, as described above.
- `app/server/startWithPreload.mjs` is the small Express wrapper that serves the
  built app in production.

## A couple of things worth knowing

- The app server uses the service role key, which bypasses row level security, so
  the safety comes from the code scoping every query to the current user. Keep
  that in mind if you add new database calls.
- Every `.env` and `.env.notification` is ignored by git and should never be
  committed. Only the `.env.example` files belong in the repo.
- If push notifications stop working after a fresh setup, check that
  `app/.env.notification` exists and has its `VAPID_PUBLIC_KEY` and
  `VAPID_PRIVATE_KEY`. Regenerating those keys logs out everyone who already
  subscribed, so do not delete the file once it is live.

That is the whole loop: install, load the SQL, fill in `.env`, then run. If
something does not come up, the first places to look are the Supabase keys and
whether the database tables actually got created.
