# RelyyCast

RelyyCast is an operator-focused control plane with a desktop streaming agent architecture.

This repo currently includes:

- Next.js UI shell
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
npm run dev         # Next.js UI on :3000
npm run api:dev     # standalone control-plane on :8787
npm run stream:dev  # local stream origin on :8177
npm run stream:ingest:tone # ffmpeg tone generator into /ingest
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

- `NEXT_PUBLIC_CONTROL_PLANE_URL` (defaults to `http://127.0.0.1:8787`)

Example:

```bash
set NEXT_PUBLIC_CONTROL_PLANE_URL=http://127.0.0.1:8787
npm run dev
```

Optional stream origin URL override for the UI:

```bash
set NEXT_PUBLIC_STREAM_ORIGIN_URL=http://127.0.0.1:8177
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
- `GET /live.mp3`
- `POST /ingest`

FFmpeg ingest helper (`npm run stream:ingest:tone`):

- Sends a continuous generated tone as MP3 into `POST /ingest`
- Override destination with `RELYY_STREAM_INGEST_URL`
- Override ffmpeg path with `FFMPEG_BIN`
