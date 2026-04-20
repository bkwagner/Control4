"""MCP server exposing Control4 devices as tools.

Run with:
    uv run control4-mcp
or:
    python -m control4_mcp.server
"""

from __future__ import annotations

import logging
import time
from typing import Any

from mcp.server.fastmcp import FastMCP
from pyControl4.climate import C4Climate
from pyControl4.light import C4Light
from pyControl4.room import C4Room

from .client import Control4Connection
from .config import Settings

log = logging.getLogger(__name__)

mcp = FastMCP("control4")
_settings = Settings.from_env()
_conn = Control4Connection(_settings)


def _slim(it: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": it.get("id"),
        "name": it.get("name"),
        "type": it.get("type"),
        "category": it.get("category"),
        "roomId": it.get("roomId"),
    }


# ---------------------------------------------------------------------------
# Discovery tools
# ---------------------------------------------------------------------------


@mcp.tool()
async def list_rooms() -> list[dict[str, Any]]:
    """List every room in the Control4 project with its id and display name."""
    director = await _conn.director()
    items = await director.get_all_items_by_category("rooms")
    return [{"id": it.get("id"), "name": it.get("name")} for it in items]


@mcp.tool()
async def list_items(category: str | None = None) -> list[dict[str, Any]]:
    """List items in the project.

    Args:
        category: Optional Control4 category filter, e.g. "lights",
            "comfort" (thermostats/climate), "sensors", "security",
            "motorization", "av". Omit to list everything.
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
    director = await _conn.director()
    await C4Light(director, item_id).set_level(level)
    return f"ok: item {item_id} set to {level}"


@mcp.tool()
async def toggle_light(item_id: int) -> str:
    """Toggle a light on/off based on its current level."""
    director = await _conn.director()
    light = C4Light(director, item_id)
    current = await light.get_level()
    target = 0 if int(current or 0) > 0 else 100
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
        hvac_mode: e.g. "Off", "Heat", "Cool", "Auto". Call
            `get_item_variables` on the climate item to see its supported modes.
    """
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
    """
    director = await _conn.director()
    await director.send_post_request(
        f"/api/v1/items/{item_id}/commands",
        command,
        params or {},
    )
    return f"ok: sent {command} to item {item_id}"


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


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    mcp.run()


if __name__ == "__main__":
    main()
