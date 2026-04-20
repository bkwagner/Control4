# control4-mcp

An MCP server that lets an LLM (Claude, Gemini, etc.) query and control a
Control4 home automation system via [pyControl4](https://github.com/lawtancool/pyControl4).

It talks directly to your local Control4 Director over the LAN. No dealer, no
cloud round-trips for commands.

## What it exposes

**Discovery**
- `list_rooms()` — every room with id + name
- `list_items(category?)` — filter by `lights`, `comfort`, `sensors`, `security`, `motorization`, `av`, etc.
- `find_items(query)` — fuzzy name search (great for "kitchen lights")
- `get_item_variables(item_id)` — current brightness, temp, power state, ...

**Control**
- `set_light_level(item_id, level)` — 0–100
- `toggle_light(item_id)`
- `set_room_off(room_id)` — ROOM_OFF
- `set_climate(item_id, heat_setpoint_f?, cool_setpoint_f?, hvac_mode?)`
- `set_variable(item_id, value)` — for programming variables you defined in Composer
- `send_command(item_id, command, params?)` — escape hatch for blinds / AV / anything else

**Real-time events** (WebSocket-backed)
- `start_event_listener()` — subscribe to every item's state updates (idempotent)
- `get_recent_events(since_seconds?, item_id?, limit?)` — read recent changes
- `wait_for_event(timeout_seconds?, item_ids?)` — block until a matching change arrives

## Setup

Requires Python 3.10+. This project uses [uv](https://github.com/astral-sh/uv),
but `pip` works fine too.

```bash
git clone <this-repo>
cd control4-mcp
cp .env.example .env
# fill in your Control4 account + local director IP
uv sync          # or: pip install -e .
```

### Finding your director IP

It's the IP of your primary controller (HC-250, EA-3, EA-5, CA-10, etc.). Check
your router's DHCP list or the Control4 app under System Info.

## Running

```bash
uv run control4-mcp        # starts the MCP server over stdio
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(or the Windows equivalent):

```json
{
  "mcpServers": {
    "control4": {
      "command": "uv",
      "args": ["--directory", "/absolute/path/to/control4-mcp", "run", "control4-mcp"]
    }
  }
}
```

Restart Claude Desktop. You should see `control4` in the tools menu and be able
to say things like _"dim the living room lights to 30% and set the thermostat
to 68"_.

### Claude Code / Agent SDK

```bash
claude mcp add control4 -- uv --directory /path/to/control4-mcp run control4-mcp
```

### Alexa / Google Assistant

The MCP server itself doesn't talk to Alexa or Google directly. Two easy
bridges:

1. **Custom skill / action → LLM → MCP.** Build a minimal Alexa Custom Skill
   (or Google Action) that forwards the utterance to a Claude or Gemini agent
   configured with this MCP server. The LLM handles intent + tool selection.
2. **Routines → webhook → MCP-as-HTTP.** Wrap the MCP tools behind a small
   FastAPI service on the same host and trigger specific intents from Alexa
   Routines / Google Home Routines. Less natural, but zero-latency and no LLM
   bill.

## Real-time events

Call `start_event_listener` once and the server will subscribe to every item
via Control4's WebSocket (socket.io) channel. State changes — lights, motion
sensors, doors, thermostat readings, variables — are buffered (last 500 by
default) and exposed via `get_recent_events` and `wait_for_event`.

Useful for things like:
- _"Wait for motion in the garage, then turn on the driveway lights if it's
  dark."_ — chain `wait_for_event(item_ids=[motion_id])` with
  `set_light_level`.
- _"What has the downstairs been doing in the last 5 minutes?"_ — call
  `get_recent_events(since_seconds=300)`.

For a truly reactive setup where a Control4 event *triggers* an LLM
conversation (rather than the LLM polling), wrap this MCP server in a small
orchestrator that watches the event bus and spawns agent calls. That's
outside the server's scope but straightforward to bolt on.

## Notes

- The director bearer token is refreshed automatically every ~12h.
- Every command goes straight to your local director — the Control4 cloud is
  only hit during the initial token exchange.
- Common director categories: `lights`, `comfort` (thermostats), `sensors`,
  `security`, `motorization` (blinds/shades), `av`, `rooms`. Use `list_items`
  without a category to see everything.

## License

MIT. pyControl4 is MIT-licensed; Control4 trademarks belong to Snap One.
