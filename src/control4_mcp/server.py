"""MCP server exposing Control4 devices as tools.

Run with:
    uv run control4-mcp
or:
    python -m control4_mcp.server
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

from mcp.server.fastmcp import FastMCP
from pyControl4.climate import C4Climate
from pyControl4.light import C4Light
from pyControl4.room import C4Room

from .directorlink import DirectorLinkClient, LinkRequestError, LinkUnavailable
from .client import Control4Connection
from .config import Settings
from .state import LightStore

log = logging.getLogger(__name__)

_HOST = os.getenv("CONTROL4_MCP_HOST", "127.0.0.1")
_PORT = int(os.getenv("CONTROL4_MCP_PORT", "8000"))

mcp = FastMCP("control4", host=_HOST, port=_PORT)
_settings = Settings.from_env()
_conn = Control4Connection(_settings)
_lights = LightStore(_conn)
# Lights, thermostats, fans, blinds and alarm status go through DirectorLink
# (formerly C4Bridge) when configured: it runs on the Director and needs no
# Control4 cloud login. Anything it can't serve falls back to the direct
# Director path.
_link = (
    DirectorLinkClient(_settings.directorlink_url, _settings.directorlink_token)
    if _settings.directorlink_token and _settings.directorlink_url
    else None
)


def _require_link() -> DirectorLinkClient:
    if _link is None:
        raise RuntimeError(
            "This tool needs DirectorLink: set CONTROL4_DIRECTORLINK_TOKEN (and optionally "
            "CONTROL4_DIRECTORLINK_URL) for the DirectorLink driver installed on the Director."
        )
    return _link


def _c_to_f(c: float | None) -> float | None:
    return None if c is None else round(c * 9 / 5 + 32, 1)


def _f_to_c(f: float) -> float:
    return round((float(f) - 32) * 5 / 9, 1)


def _room_name(d: dict[str, Any]) -> str | None:
    room = d.get("room")
    return room.get("name") if isinstance(room, dict) else None


def _in_room(rows: list[dict[str, Any]], room: str | None) -> list[dict[str, Any]]:
    if not room:
        return rows
    needle = room.strip().lower()
    return [r for r in rows if needle in str(r.get("roomName") or "").lower()]

# Commands that unlock doors or change alarm state. The generic escape hatch
# refuses these unless explicitly enabled, so an LLM (or anyone who reaches
# the SSE endpoint) can't disarm the house through `send_command`.
_SECURITY_COMMANDS = {"UNLOCK", "DISARM", "DISARM_PARTITION"}
_SECURITY_COMMAND_PREFIXES = ("ARM_", "PARTITION_")


def _is_security_command(command: str) -> bool:
    c = command.strip().upper()
    return c in _SECURITY_COMMANDS or c.startswith(_SECURITY_COMMAND_PREFIXES)


def _slim(it: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": it.get("id"),
        "name": it.get("name"),
        "typeName": it.get("typeName"),
        "categories": it.get("categories") or [],
        "roomId": it.get("roomId"),
        "roomName": it.get("roomName"),
        "floorName": it.get("floorName"),
    }


# ---------------------------------------------------------------------------
# Discovery tools
# ---------------------------------------------------------------------------


@mcp.tool()
async def list_rooms() -> list[dict[str, Any]]:
    """List every room in the Control4 project with id, name, and floor."""
    director = await _conn.director()
    items = await director.get_all_item_info()
    return [
        {
            "id": it.get("id"),
            "name": it.get("name"),
            "floorName": it.get("floorName"),
        }
        for it in items
        if it.get("typeName") == "room"
    ]


@mcp.tool()
async def list_items(category: str | None = None) -> list[dict[str, Any]]:
    """List items in the project.

    Args:
        category: Optional Control4 category filter. Valid values:
            "lights", "comfort", "thermostats", "sensors", "cameras",
            "audio_video", "motorization", "motors", "controllers",
            "outlet_wireless_dimmer", "control4_remote_hub", "voice-scene".
            Omit to list everything (rooms, floors, devices, agents, ...).
    """
    director = await _conn.director()
    items = (
        await director.get_all_items_by_category(category)
        if category
        else await director.get_all_item_info()
    )
    return [_slim(it) for it in items]


@mcp.tool()
async def find_items(query: str) -> list[dict[str, Any]]:
    """Fuzzy-search items by name (case-insensitive substring match).

    Useful when a user says "kitchen lights" and you need an item id.
    """
    needle = query.strip().lower()
    director = await _conn.director()
    items = await director.get_all_item_info()
    return [_slim(it) for it in items if needle in str(it.get("name", "")).lower()]


@mcp.tool()
async def list_lights(room: str | None = None, only_on: bool = False) -> list[dict[str, Any]]:
    """List lights with their current state in one call.

    Each light has `level` (0-100, dimmers only), `state` (1 on / 0 off) and
    `dimmable`. Much cheaper than calling `get_item_variables` per light.

    Args:
        room: Optional case-insensitive substring of the room name.
        only_on: If true, return only lights that are currently on.
    """
    rows: list[dict[str, Any]] | None = None
    if _link is not None:
        try:
            rows = [
                {
                    "id": d["id"],
                    "name": d.get("name"),
                    "roomId": (d.get("room") or {}).get("id"),
                    "roomName": _room_name(d),
                    "level": d.get("brightness") if d.get("dimmable") else None,
                    "state": 1 if d.get("on") else 0,
                    "dimmable": bool(d.get("dimmable")),
                }
                for d in await _link.items("lights")
            ]
        except LinkUnavailable as e:
            log.info("list_lights: %s; using Director", e)
    if rows is None:
        rows = await _lights.lights()
    rows = _in_room(rows, room)
    if only_on:
        rows = [r for r in rows if (r["level"] or 0) > 0 or r["state"] == 1]
    return rows


@mcp.tool()
async def get_item_variables(item_id: int) -> list[dict[str, Any]]:
    """Return every variable and its current value for a given item id.

    Use this to inspect current brightness, temperature, power state, etc.
    """
    director = await _conn.director()
    return await director.get_item_variables(item_id)


# ---------------------------------------------------------------------------
# Control tools
# ---------------------------------------------------------------------------


@mcp.tool()
async def set_light_level(item_id: int, level: int) -> str:
    """Set a light's brightness.

    Args:
        item_id: Control4 item id of the light.
        level: 0 (off) through 100 (full). Non-dimmable switches treat any
            non-zero value as on.
    """
    level = max(0, min(100, int(level)))
    if _link is not None:
        try:
            light = await _link.get("lights", item_id)
            if level == 0:
                changes: dict[str, Any] = {"on": False}
            elif light.get("dimmable"):
                changes = {"on": True, "brightness": level}
            else:
                changes = {"on": True}  # non-dimming switch
            await _link.patch("lights", item_id, changes)
            return f"ok: item {item_id} set to {level}"
        except LinkUnavailable as e:
            log.info("set_light_level: %s; using Director", e)
        except LinkRequestError as e:
            return f"error: {e}"
    director = await _conn.director()
    await C4Light(director, item_id).set_level(level)
    return f"ok: item {item_id} set to {level}"


@mcp.tool()
async def toggle_light(item_id: int) -> str:
    """Toggle a light on/off based on its current level."""
    if _link is not None:
        try:
            light = await _link.get("lights", item_id)
            turn_on = not light.get("on")
            await _link.patch("lights", item_id, {"on": turn_on})
            return f"ok: item {item_id} turned {'on' if turn_on else 'off'}"
        except LinkUnavailable as e:
            log.info("toggle_light: %s; using Director", e)
        except LinkRequestError as e:
            return f"error: {e}"
    director = await _conn.director()
    light = C4Light(director, item_id)
    # Non-dimming switches have no LIGHT_LEVEL; fall back to LIGHT_STATE.
    try:
        current = await light.get_level()
    except Exception:  # noqa: BLE001
        current = None
    is_on = int(current) > 0 if current is not None else bool(await light.get_state())
    target = 0 if is_on else 100
    await light.set_level(target)
    return f"ok: item {item_id} toggled to {target}"


@mcp.tool()
async def set_room_off(room_id: int) -> str:
    """Turn everything off in a room (Control4 ROOM_OFF)."""
    director = await _conn.director()
    await C4Room(director, room_id).set_room_off()
    return f"ok: room {room_id} off"


@mcp.tool()
async def set_climate(
    item_id: int,
    heat_setpoint_f: float | None = None,
    cool_setpoint_f: float | None = None,
    hvac_mode: str | None = None,
) -> str:
    """Adjust a thermostat / climate device. Pass any combination of args.

    Args:
        item_id: Climate item id.
        heat_setpoint_f: Heat setpoint in Fahrenheit.
        cool_setpoint_f: Cool setpoint in Fahrenheit.
        hvac_mode: e.g. "Off", "Heat", "Cool", "Auto". `list_thermostats`
            shows each thermostat's supported modes.
    """
    if heat_setpoint_f is None and cool_setpoint_f is None and hvac_mode is None:
        return "no-op: pass at least one of heat_setpoint_f, cool_setpoint_f, or hvac_mode"
    if _link is not None:
        try:
            return await _link_set_climate(item_id, heat_setpoint_f, cool_setpoint_f, hvac_mode)
        except LinkUnavailable as e:
            log.info("set_climate: %s; using Director", e)
        except LinkRequestError as e:
            return f"error: {e}"
    director = await _conn.director()
    climate = C4Climate(director, item_id)
    actions: list[str] = []
    if heat_setpoint_f is not None:
        await climate.set_heat_setpoint_f(float(heat_setpoint_f))
        actions.append(f"heat={heat_setpoint_f}")
    if cool_setpoint_f is not None:
        await climate.set_cool_setpoint_f(float(cool_setpoint_f))
        actions.append(f"cool={cool_setpoint_f}")
    if hvac_mode is not None:
        await climate.set_hvac_mode(hvac_mode)
        actions.append(f"mode={hvac_mode}")
    if not actions:
        return "no-op: pass at least one of heat_setpoint_f, cool_setpoint_f, or hvac_mode"
    return f"ok: climate {item_id} {' '.join(actions)}"


async def _link_set_climate(
    item_id: int,
    heat_f: float | None,
    cool_f: float | None,
    hvac_mode: str | None,
) -> str:
    assert _link is not None
    thermostat = await _link.get("thermostats", item_id)
    changes: dict[str, Any] = {}
    if hvac_mode is not None:
        changes["mode"] = hvac_mode.strip().lower()
    if thermostat.get("setpoints") == "dual":
        if heat_f is not None:
            changes["heat_setpoint"] = _f_to_c(heat_f)
        if cool_f is not None:
            changes["cool_setpoint"] = _f_to_c(cool_f)
    else:
        # Single-setpoint thermostats take one target.
        target_f = heat_f if heat_f is not None else cool_f
        if target_f is not None:
            changes["target_temperature"] = _f_to_c(target_f)
    # DirectorLink applies mode first, then the setpoints (API temps are °C).
    await _link.patch("thermostats", item_id, changes)
    parts = [f"{k}={v}" for k, v in changes.items()]
    return f"ok: climate {item_id} {' '.join(parts)} (°C)"


@mcp.tool()
async def list_thermostats(room: str | None = None) -> list[dict[str, Any]]:
    """List thermostats: current temperature, setpoints, mode and what the
    system is doing right now (`running`). Temperatures in °F.
    Requires DirectorLink.

    Args:
        room: Optional case-insensitive substring of the room name.
    """
    rows = []
    for d in await _require_link().items("thermostats"):
        dual = d.get("setpoints") == "dual"
        rows.append({
            "id": d["id"],
            "name": d.get("name"),
            "roomName": _room_name(d),
            "online": d.get("online"),
            "current_f": _c_to_f(d.get("current_temperature")),
            "heat_setpoint_f": _c_to_f(d.get("heat_setpoint")) if dual else None,
            "cool_setpoint_f": _c_to_f(d.get("cool_setpoint")) if dual else None,
            "target_f": None if dual else _c_to_f(d.get("target_temperature")),
            "mode": d.get("mode"),
            "running": d.get("activity"),
            "fan": d.get("fan_speed"),
            "modes": d.get("modes"),
            "fan_modes": d.get("fan_speeds"),
            "setpoints": d.get("setpoints"),
        })
    return _in_room(rows, room)


_FAN_SPEED_NAMES = {"low": 1, "medium": 2, "medium_high": 3, "high": 4}


@mcp.tool()
async def list_fans(room: str | None = None) -> list[dict[str, Any]]:
    """List ceiling/exhaust fans with power and speed (1 low, 2 medium,
    3 medium_high, 4 high). Requires DirectorLink."""
    rows = [
        {
            "id": d["id"],
            "name": d.get("name"),
            "roomName": _room_name(d),
            "on": d.get("on"),
            "speed": d.get("speed"),
            "speeds": d.get("speeds"),
        }
        for d in await _require_link().items("fans")
    ]
    return _in_room(rows, room)


@mcp.tool()
async def set_fan(item_id: int, on: bool | None = None, speed: str | None = None) -> str:
    """Turn a fan on/off or set its speed. Requires DirectorLink.

    Args:
        item_id: Fan id from `list_fans`.
        on: True to turn on (at its preset speed), False to turn off.
        speed: "low", "medium", "medium_high", "high", "off", or 1-4.
            Setting a speed also turns the fan on.
    """
    link = _require_link()
    changes: dict[str, Any] = {}
    if speed is not None:
        name = str(speed).strip().lower()
        if name in ("off", "0"):
            changes["on"] = False
        else:
            level = _FAN_SPEED_NAMES.get(name) or (int(name) if name.isdigit() else None)
            if level not in (1, 2, 3, 4):
                return 'error: speed must be "low", "medium", "medium_high", "high", "off" or 1-4'
            changes.update({"on": True, "speed": level})
    elif on is not None:
        changes["on"] = bool(on)
    else:
        return "no-op: pass on or speed"
    try:
        await link.patch("fans", item_id, changes)
    except LinkRequestError as e:
        return f"error: {e}"
    return f"ok: fan {item_id} {changes}"


@mcp.tool()
async def list_blinds(room: str | None = None) -> list[dict[str, Any]]:
    """List shades/blinds with position (0 closed - 100 open; null if the motor
    hasn't reported one) and movement. Requires DirectorLink."""
    rows = [
        {
            "id": d["id"],
            "name": d.get("name"),
            "roomName": _room_name(d),
            "position": d.get("position"),
            "position_known": d.get("position") is not None,
            "movement": d.get("direction") or ("moving" if d.get("moving") else "stopped"),
        }
        for d in await _require_link().items("blinds")
    ]
    return _in_room(rows, room)


@mcp.tool()
async def set_blind(item_id: int, action: str | None = None, position: int | None = None) -> str:
    """Open, close, stop, or position a shade/blind. Requires DirectorLink.

    Args:
        item_id: Blind id from `list_blinds`.
        action: "open", "close" or "stop".
        position: 0 (closed) through 100 (open); used when action is omitted.
    """
    link = _require_link()
    try:
        if action is not None:
            act = action.strip().lower()
            if act == "stop":
                await link.stop_blind(item_id)
            elif act in ("open", "close"):
                await link.patch("blinds", item_id, {"position": 100 if act == "open" else 0})
            else:
                return 'error: action must be "open", "close" or "stop"'
            return f"ok: blind {item_id} {act}"
        if position is not None:
            target = max(0, min(100, int(position)))
            await link.patch("blinds", item_id, {"position": target})
            return f"ok: blind {item_id} position={target}"
    except LinkRequestError as e:
        return f"error: {e}"
    return "no-op: pass action or position"


@mcp.tool()
async def get_alarm_status() -> list[dict[str, Any]]:
    """Read-only security system status per partition: armed/disarmed, alarm,
    open zones, entry/exit delay, trouble. Arming/disarming is not available.
    Requires DirectorLink with its "Alarm Status" property turned on."""
    data = await _require_link().alarm()
    if not data.get("enabled"):
        raise RuntimeError('Alarm status is off in DirectorLink (Composer property "Alarm Status").')
    return [
        {
            "id": p.get("id"),
            "name": p.get("name"),
            "state": p.get("state"),
            "armed": p.get("armed"),
            "armed_mode": p.get("armed_mode"),
            "alarm": p.get("alarm"),
            "open_zones": p.get("open_zones"),
            "delay": p.get("delay"),
            "trouble": p.get("trouble"),
        }
        for p in data.get("partitions") or []
    ]


@mcp.tool()
async def set_variable(item_id: int, value: str) -> str:
    """Set a Control4 programming variable's value by its item id."""
    director = await _conn.director()
    await director.send_post_request(
        f"/api/v1/items/{item_id}/commands",
        "SET",
        {"VALUE": value},
    )
    return f"ok: variable {item_id} = {value}"


@mcp.tool()
async def send_command(
    item_id: int,
    command: str,
    params: dict[str, Any] | None = None,
) -> str:
    """Generic escape hatch: send any Director command to any item.

    Use this for blinds, AV, security, or anything without a dedicated tool.

    Args:
        item_id: Target item id.
        command: Command name (e.g. "OPEN", "CLOSE", "SELECT_VIDEO_DEVICE").
        params: Optional parameters dict for the command.

    Lock-opening and alarm commands (UNLOCK, DISARM, ARM_*) are refused
    unless the server runs with CONTROL4_ALLOW_SECURITY=1.
    """
    if _is_security_command(command) and os.getenv("CONTROL4_ALLOW_SECURITY") != "1":
        return (
            f"refused: {command} is a security command; set "
            "CONTROL4_ALLOW_SECURITY=1 on the server to allow it"
        )
    director = await _conn.director()
    await director.send_post_request(
        f"/api/v1/items/{item_id}/commands",
        command,
        params or {},
    )
    return f"ok: sent {command} to item {item_id}"


# ---------------------------------------------------------------------------
# Audio / Video tools (room-level playback, volume, source routing)
# ---------------------------------------------------------------------------

# Proxies that represent selectable media sources in Control4. Everything else
# in the audio_video category (amps, switches, per-room media_player surfaces)
# is output-side wiring and shouldn't show up as "things you can play".
_SOURCE_PROXIES = {
    "media_service",
    "tv",
    "cable",
    "cd",
    "dvd",
    "control4_network_mediastorage",
}


def _is_source(item: dict[str, Any]) -> bool:
    proxy = str(item.get("proxy") or "")
    return proxy in _SOURCE_PROXIES or proxy.startswith("rf_")


@mcp.tool()
async def list_media_sources() -> list[dict[str, Any]]:
    """List playable audio/video sources (music services, tuners, TV, etc.).

    Use the returned `id` as the `source_id` for `set_room_audio_source` or
    `set_room_video_source`.
    """
    director = await _conn.director()
    items = await director.get_all_items_by_category("audio_video")
    return [
        {
            "id": it.get("id"),
            "name": it.get("name"),
            "proxy": it.get("proxy"),
            "roomName": it.get("roomName"),
        }
        for it in items
        if _is_source(it)
    ]


@mcp.tool()
async def get_room_av_state(room_id: int) -> dict[str, Any]:
    """Get a room's current AV state: on/off, volume (0-100), muted.

    A volume of -1 means the room has no audio output configured.
    """
    director = await _conn.director()
    room = C4Room(director, room_id)
    return {
        "room_id": room_id,
        "is_on": await room.is_on(),
        "volume": await room.get_volume(),
        "muted": await room.is_muted(),
    }


@mcp.tool()
async def set_room_volume(room_id: int, volume: int) -> str:
    """Set a room's playback volume (0-100)."""
    volume = max(0, min(100, int(volume)))
    director = await _conn.director()
    await C4Room(director, room_id).set_volume(volume)
    return f"ok: room {room_id} volume={volume}"


@mcp.tool()
async def toggle_room_mute(room_id: int) -> str:
    """Toggle mute for a room."""
    director = await _conn.director()
    await C4Room(director, room_id).toggle_mute()
    return f"ok: room {room_id} mute toggled"


@mcp.tool()
async def set_room_audio_source(room_id: int, source_id: int) -> str:
    """Route an audio-only source to a room (turns the room on).

    `source_id` should be an id from `list_media_sources`. Use this for music;
    use `set_room_video_source` for TV.
    """
    director = await _conn.director()
    await C4Room(director, room_id).set_audio_source(source_id)
    return f"ok: room {room_id} audio source = {source_id}"


@mcp.tool()
async def set_room_video_source(room_id: int, source_id: int) -> str:
    """Route a video+audio source to a room (turns the room on)."""
    director = await _conn.director()
    await C4Room(director, room_id).set_video_and_audio_source(source_id)
    return f"ok: room {room_id} video source = {source_id}"


@mcp.tool()
async def media_play(room_id: int) -> str:
    """Send PLAY to whatever source is currently routed to the room."""
    director = await _conn.director()
    await C4Room(director, room_id).set_play()
    return f"ok: room {room_id} play"


@mcp.tool()
async def media_pause(room_id: int) -> str:
    """Send PAUSE to the current source in the room."""
    director = await _conn.director()
    await C4Room(director, room_id).set_pause()
    return f"ok: room {room_id} pause"


@mcp.tool()
async def media_stop(room_id: int) -> str:
    """Send STOP to the current source in the room."""
    director = await _conn.director()
    await C4Room(director, room_id).set_stop()
    return f"ok: room {room_id} stop"


# ---------------------------------------------------------------------------
# Real-time event tools (WebSocket-backed)
# ---------------------------------------------------------------------------


@mcp.tool()
async def start_event_listener() -> str:
    """Start the Control4 WebSocket listener.

    Idempotent — safe to call repeatedly. After this runs, every item state
    change is recorded in a rolling buffer and surfaced by `get_recent_events`
    / `wait_for_event`.
    """
    await _conn.ensure_websocket_started()
    return "ok: websocket listener running"


@mcp.tool()
async def get_recent_events(
    since_seconds: float = 60,
    item_id: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Return recent state-change events from the event buffer.

    Requires `start_event_listener` to have been called.

    Args:
        since_seconds: Only return events from the last N seconds.
        item_id: Optional filter — only events for this item.
        limit: Max events to return (newest-first trimming).
    """
    await _conn.ensure_websocket_started()
    since_ts = time.time() - max(0.0, float(since_seconds))
    return [
        ev.to_dict()
        for ev in _conn.events.recent(since_ts=since_ts, item_id=item_id, limit=limit)
    ]


@mcp.tool()
async def wait_for_event(
    timeout_seconds: float = 30,
    item_ids: list[int] | None = None,
) -> dict[str, Any] | None:
    """Block until a matching state-change arrives, or return None on timeout.

    Handy for confirmations ("turn on the driveway lights and wait for the
    motion sensor to clear") or for scene validation.

    Args:
        timeout_seconds: Max seconds to wait.
        item_ids: If provided, only events for one of these item ids match.
            Omit to wake on the first event for any item.
    """
    await _conn.ensure_websocket_started()
    ev = await _conn.events.wait(item_ids=item_ids, timeout=float(timeout_seconds))
    return ev.to_dict() if ev else None


def _is_loopback(host: str) -> bool:
    return host in ("127.0.0.1", "::1", "localhost")


def _bearer_auth(app: Any, token: str) -> Any:
    """ASGI middleware: require `Authorization: Bearer <token>` on every
    HTTP request except the unauthenticated liveness probe."""
    import hmac

    expected = f"Bearer {token}".encode()

    async def middleware(scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http" or scope.get("path") == "/api/health":
            await app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        supplied = headers.get(b"authorization", b"")
        if not hmac.compare_digest(supplied, expected):
            await send(
                {
                    "type": "http.response.start",
                    "status": 401,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"www-authenticate", b"Bearer"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": b'{"detail":"unauthorized"}'})
            return
        await app(scope, receive, send)

    return middleware


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    transport = os.getenv("CONTROL4_MCP_TRANSPORT", "stdio")

    if transport == "stdio":
        mcp.run(transport="stdio")
        return

    if transport != "sse":
        raise SystemExit(f"Unsupported CONTROL4_MCP_TRANSPORT={transport!r}; use 'stdio' or 'sse'.")

    token = os.getenv("CONTROL4_MCP_TOKEN", "")
    if not token and not _is_loopback(_HOST):
        raise SystemExit(
            f"Refusing to listen on {_HOST} without CONTROL4_MCP_TOKEN. "
            "Anyone who can reach this port could control the house. Set a "
            "long random CONTROL4_MCP_TOKEN, or bind to 127.0.0.1."
        )
    if not token:
        log.warning("CONTROL4_MCP_TOKEN not set; SSE server is unauthenticated (localhost only)")

    # Mount the REST layer under /api alongside the MCP SSE endpoint on the
    # same uvicorn instance. MCP clients hit /sse.
    import uvicorn
    from starlette.applications import Starlette
    from starlette.routing import Mount

    from .api import create_api

    app: Any = Starlette(
        routes=[
            Mount("/api", app=create_api(_conn, _lights)),
            Mount("/", app=mcp.sse_app()),
        ]
    )
    if token:
        app = _bearer_auth(app, token)
    uvicorn.run(app, host=_HOST, port=_PORT)


if __name__ == "__main__":
    main()
