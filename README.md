# RelyyCast

RelyyCast is an operator-focused control plane with a desktop streaming agent architecture.

This repo currently includes:

- Vite + React UI shell
- Desktop pairing + heartbeat API scaffolds
- Standalone control-plane server scaffold
- Local MP3 stream origin scaffold

## Development commands

Install dependencies:

```bash
npm install
```

Run UI + standalone API + stream origin together:

```bash
npm run stack:dev
```

Run pieces independently:

```bash
npm run dev         # Vite UI on :3000
npm run api:dev     # standalone control-plane on :8787
npm run stream:dev  # local stream origin on :8177
npm run stream:ingest:tone # ffmpeg tone generator into a mount (default /live.mp3)
npm run app:view    # open :3000 in app-style window (Edge/Chrome app mode on Windows)
npm run dev:app     # run app-style view; reuses existing :3000 dev server if already running
npm run neutralino:update # download Neutralino runtime binary
npm run dev:neutralino    # run real Neutralino native window (frameless config)
```

Build:

```bash
npm run build
```

Lint:

```bash
npm run lint
```

## Control-plane URL for UI

The Agent tab in the UI calls the standalone control-plane server using:

- `VITE_CONTROL_PLANE_URL` (defaults to `http://127.0.0.1:8787`)

Example:

```bash
set VITE_CONTROL_PLANE_URL=http://127.0.0.1:8787
npm run dev
```

Optional stream origin URL override for the UI:

```bash
set VITE_STREAM_ORIGIN_URL=http://127.0.0.1:8177
npm run dev
```

## Current scaffold endpoints

Standalone control-plane server (`npm run api:dev`):

- `GET /health`
- `POST /api/desktop/pair/start`
- `POST /api/desktop/pair/approve`
- `POST /api/desktop/pair/status`
- `POST /api/desktop/heartbeat`
- `GET /api/desktop/heartbeat?agentId=...`

Local stream origin (`npm run stream:dev`):

- `GET /health`
- `GET /api/mounts`
- `GET|HEAD /<mount>` (examples: `/station1`, `/live`, `/stream`, `/live.mp3`)
- `SOURCE|PUT|POST /<mount>` (source publishing)
- `GET|POST /admin/metadata?mount=/live&song=Artist+-+Track`
- `POST /ingest?mount=/live` (legacy helper endpoint; forwards to source handler)

FFmpeg ingest helper (`npm run stream:ingest:tone`):

- Sends audio into a source mount (defaults to synthetic tone)
- Default publish target is `SOURCE http://127.0.0.1:8177/live.mp3`
- Uses `FFMPEG_BIN` or `RELYY_RADIO_FFMPEG_PATH` when set
- Override destination with `RELYY_STREAM_INGEST_URL`, or use `RELYY_STREAM_BASE_URL` + `RELYY_STREAM_MOUNT`
- Override source method with `RELYY_STREAM_SOURCE_METHOD` (`SOURCE`, `PUT`, or `POST`)
- Relay a client stream URL by setting `RELYY_STREAM_INPUT_URL` (for example `http://127.0.0.1:4850/live.mp3`)
- Force synthetic tone mode with `RELYY_STREAM_INPUT_MODE=tone`
- Set source auth using `RELYY_STREAM_SOURCE_USER` + `RELYY_STREAM_SOURCE_PASSWORD`
- Override ffmpeg path with `FFMPEG_BIN`
