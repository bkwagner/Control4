# Control4

Two ways to drive a [Control4](https://www.control4.com/) home automation
system from modern tooling, both talking directly to your local Director over
the LAN (no dealer, no cloud round-trips for commands):

- **`control4-mcp`** — a Python server that exposes Control4 as MCP tools for
  Claude / Gemini / any MCP client, plus an optional FastAPI REST layer.
- **`control4-app`** — an Electron desktop app with a React UI for day-to-day
  use (rooms, lights, climate, and whole-house audio/video with matrix-aware
  source routing).

They're independent. Use the MCP server for LLM control and integrations, use
the app as a clean human-facing surface. Both share the same Control4 account
and hit the same Director.

---

## Repository layout

```
.
├── src/control4_mcp/        # Python MCP server + FastAPI layer
│   ├── server.py            # FastMCP tool registry (stdio / SSE transports)
│   ├── api.py               # REST endpoints mounted at /api
│   ├── client.py            # Director session + WebSocket event listener
│   ├── events.py            # Rolling event buffer
│   └── config.py
├── control4-app/            # Electron + React desktop app
│   ├── electron/            # Main process + Control4 client (TypeScript)
│   │   └── control4/        # Direct-to-director client (auth, director, client)
│   ├── src/                 # React UI (Vite)
│   │   ├── components/      # RoomList, LightsGrid, AudioPanel, ClimatePanel, …
│   │   └── lib/             # IPC shim + DTO types
│   └── scripts/             # Diagnostic scripts (live-data inspection)
├── Dockerfile               # MCP server image
├── compose.yml
├── smoke_test.py            # End-to-end exercise of the MCP tool functions
└── pyproject.toml
```

---

## `control4-mcp` — MCP server + REST API

Requires Python 3.10+. Uses [uv](https://github.com/astral-sh/uv); `pip` works too.

```bash
git clone https://github.com/bkwagner/Control4.git
cd Control4
cp .env.example .env
# fill in CONTROL4_USERNAME / CONTROL4_PASSWORD / CONTROL4_DIRECTOR_IP
uv sync                      # or: pip install -e .
uv run control4-mcp          # starts the MCP server over stdio
```

### What it exposes (MCP tools)

**Discovery**
- `list_rooms()` — every room with id + name + floor
- `list_items(category?)` — filter by `lights`, `comfort`, `thermostats`,
  `sensors`, `cameras`, `audio_video`, `motorization`, `motors`, …
- `find_items(query)` — fuzzy name search
- `get_item_variables(item_id)` — current brightness, temp, power state, …

**Control**
- `set_light_level(item_id, level)` — 0–100
- `toggle_light(item_id)`
- `set_room_off(room_id)` — ROOM_OFF
- `set_climate(item_id, heat_setpoint_f?, cool_setpoint_f?, hvac_mode?)`
- `set_variable(item_id, value)` — for Composer programming variables
- `send_command(item_id, command, params?)` — generic Director escape hatch

**Audio / Video**
- `list_media_sources()` — playable sources (music services, tuners, NAS, TV, cable, CD/DVD)
- `get_room_av_state(room_id)` — on/off, volume, muted
- `set_room_volume(room_id, 0-100)` / `toggle_room_mute(room_id)`
- `set_room_audio_source(room_id, source_id)` / `set_room_video_source(room_id, source_id)`
- `media_play(room_id)` / `media_pause(room_id)` / `media_stop(room_id)`

**Real-time events** (WebSocket-backed)
- `start_event_listener()` — subscribe to every item's state updates (idempotent)
- `get_recent_events(since_seconds?, item_id?, limit?)`
- `wait_for_event(timeout_seconds?, item_ids?)` — block until a matching change arrives

### REST API (FastAPI)

When run with the SSE transport, the server also mounts a small REST layer at
`/api` so non-MCP frontends (like the Electron app, dashboards, or scripts)
can speak plain HTTP + JSON against the same session.

```bash
CONTROL4_MCP_TRANSPORT=sse CONTROL4_MCP_PORT=8000 uv run control4-mcp
# MCP SSE:   http://localhost:8000/sse
# REST API:  http://localhost:8000/api/health
```

Endpoints:

| Method | Path                                   | Purpose                          |
|--------|----------------------------------------|----------------------------------|
| GET    | `/api/health`                          | Liveness                         |
| GET    | `/api/rooms`                           | Rooms with floor info            |
| POST   | `/api/rooms/{id}/off`                  | ROOM_OFF                         |
| GET    | `/api/items?category=...`              | Slim item list                   |
| GET    | `/api/items/{id}/variables`            | Current variables                |
| GET    | `/api/lights`                          | Lights + levels in one call      |
| POST   | `/api/lights/{id}/level`               | `{ "level": 0-100 }`             |
| GET    | `/api/climate`                         | Thermostats                      |
| POST   | `/api/climate/{id}`                    | `{ heat_setpoint_f?, cool_setpoint_f?, hvac_mode? }` |
| GET    | `/api/av/sources`                      | Playable sources                 |
| GET    | `/api/av/rooms/{id}`                   | Room AV state                    |
| POST   | `/api/av/rooms/{id}/volume`            | `{ "volume": 0-100 }`            |
| POST   | `/api/av/rooms/{id}/mute/toggle`       |                                  |
| POST   | `/api/av/rooms/{id}/audio-source`      | `{ "source_id": N }`             |
| POST   | `/api/av/rooms/{id}/video-source`      | `{ "source_id": N }`             |
| POST   | `/api/av/rooms/{id}/{play\|pause\|stop}` | Transport control              |

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(or the Windows equivalent):

```json
{
  "mcpServers": {
    "control4": {
      "command": "uv",
      "args": ["--directory", "/absolute/path/to/Control4", "run", "control4-mcp"]
    }
  }
}
```

### Claude Code / Agent SDK

```bash
claude mcp add control4 -- uv --directory /path/to/Control4 run control4-mcp
```

### Docker

Build once:

```bash
docker compose build           # or: docker build -t control4-mcp:latest .
```

Wire the MCP client to `docker run` the image (stdio transport):

```json
{
  "mcpServers": {
    "control4": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--env-file", "/absolute/path/to/.env",
        "--network", "host",
        "control4-mcp:latest"
      ]
    }
  }
}
```

Notes:
- `-i` is required (stdio pipe); **do not** pass `-t` — a TTY corrupts the
  protocol stream.
- `--network host` is the easy button on Linux. On macOS/Windows Docker
  Desktop, drop that flag and use bridge networking — your director's LAN IP
  is still routable from the Docker VM.
- Smoke test: `npx @modelcontextprotocol/inspector docker run -i --rm --env-file .env --network host control4-mcp:latest`

On Docker Desktop for Windows, forward slashes in JSON paths (or escaped
backslashes) work; `--network host` is optional but needs explicit enabling
(4.34+), and Docker Desktop must be running when your MCP client spawns the
container.

### Alexa / Google Assistant

The MCP server itself doesn't talk to Alexa or Google directly. Two easy
bridges:

1. **Custom skill → LLM → MCP.** A minimal Alexa Custom Skill (or Google
   Action) forwards the utterance to a Claude/Gemini agent configured with
   this MCP server. The LLM handles intent + tool selection.
2. **Routines → webhook → MCP-as-HTTP.** Use the FastAPI layer (SSE mode) and
   call it from Alexa/Google Home Routines. Lower latency, no LLM bill, but
   limited to pre-wired intents.

---

## `control4-app` — Electron desktop app

A React + Electron UI that drives Control4 directly. Unlike the MCP server,
the app **does not** go through the Python REST layer — the Electron main
process owns its own Director session in TypeScript, so the app is a single
self-contained executable with no Python dependency.

### Features

- **Rooms** — per-floor listing, capability-aware (audio-only / video-only /
  both / matrix-audio rooms are all distinguished)
- **Lights** — mixed dimmer/switch grid with level sliders
- **Climate** — thermostats with heat/cool setpoints and HVAC mode
- **Audio / Video** — room volume & mute, source picker that respects the
  actual wiring of your installation:
  - Direct-wired sources only show in rooms where they're physically present
  - Matrix-routed services (SiriusXM, Pandora, Spotify Connect, …) show in
    every room with a non-TV audio path
  - Aggregator tiles (Stations, My Movies, …) behave like they do in
    Navigator — cross-service browse in the hub room, scoped otherwise
  - ShairBridge AirPlay endpoints stay scoped to their advertised room
- **Browse** — paginated deep media browse per source (SiriusXM channels,
  Pandora stations, NAS playlists, broadcast TV guide, …) using Director's
  `SELECT_*_MEDIA` command catalog

### How it figures out what's where

Most of the app's cleverness is in
[`electron/control4/client.ts`](control4-app/electron/control4/client.ts): rather than
relying on heuristics over proxy names, it walks each source's actual binding
tree to decide whether a tile carries audio, video, or both; whether it's
directly wired or matrix-routed (via an amp or a distributed-audio hub); and
which specific rooms it reaches. The `scripts/` folder has a handful of
diagnostic tools (`preview-master-bath.mjs`, `trace-matrix.mjs`,
`identify-hub.mjs`, …) that mirror this logic against your live Director so
you can sanity-check a new install or debug a surprising source listing.

### Running (dev)

```bash
cd control4-app
npm install
npm run dev                  # Vite (5173) + Electron main with hot reload
```

The first launch opens a setup screen asking for your Control4 account and
Director IP; those settings are persisted to Electron's `userData` (e.g.
`%APPDATA%/control4-app/settings.json` on Windows).

### Building

```bash
npm run build                # tsc + vite build → dist/ + dist-electron/
npm run typecheck            # both renderer and main tsconfigs
npm run dist:win             # NSIS installer → control4-app/release/
npm run dist:dir             # unpacked .exe (faster smoke test)
```

### Auto-update

The packaged app checks GitHub Releases on launch (and every 6h after) via
[electron-updater](https://www.electron.build/auto-update). When a newer
tag is found, the new installer downloads in the background; the user sees
a "Restart to update" pill in the header and a dialog prompting to restart
when the download finishes. Skipping the prompt defers the install to the
next app quit.

Cutting a release:

```bash
# bump the version in control4-app/package.json, e.g. 0.1.0 → 0.1.1
GH_TOKEN=ghp_your_token npm run release  # from control4-app/
```

`npm run release` runs `electron-builder --win --publish always`, which
builds the NSIS installer and uploads it (plus the `latest.yml` manifest
that `electron-updater` reads) as assets on the GitHub release matching
the current `package.json` version. The token needs `repo` scope.

Unsigned builds still auto-update, but Windows SmartScreen warns users on
each install — "More info → Run anyway" gets past it. A code-signing cert
(Sectigo / DigiCert, ~$100–400/yr) removes the warning entirely.

---

## Real-time events

Call `start_event_listener` once (MCP) and the server subscribes to every
item via Control4's WebSocket (socket.io) channel. State changes — lights,
motion, doors, thermostat readings, variables — are buffered (last 500 by
default) and exposed via `get_recent_events` and `wait_for_event`.

Useful for things like:

- _"Wait for motion in the garage, then turn on the driveway lights if it's
  dark."_ — chain `wait_for_event(item_ids=[motion_id])` with
  `set_light_level`.
- _"What has the downstairs been doing in the last 5 minutes?"_ — call
  `get_recent_events(since_seconds=300)`.

For a truly reactive setup where a Control4 event *triggers* an LLM
conversation, wrap the MCP server in a small orchestrator that watches the
event bus and spawns agent calls.

---

## Notes

- The Director bearer token is refreshed automatically every ~12h.
- Every command goes straight to your local Director — the Control4 cloud is
  only hit during the initial token exchange.
- Finding your director IP: it's the IP of your primary controller (HC-250,
  EA-3, EA-5, CA-10, …). Check your router's DHCP list or the Control4 app
  under System Info.
- Valid Director categories (per pyControl4): `lights`, `comfort`,
  `thermostats`, `sensors`, `cameras`, `audio_video`, `motorization`,
  `motors`, `controllers`, `outlet_wireless_dimmer`, `control4_remote_hub`,
  `voice-scene`. Rooms aren't a category — use `list_rooms` instead.

## License

MIT. pyControl4 is MIT-licensed; Control4 trademarks belong to Snap One.
