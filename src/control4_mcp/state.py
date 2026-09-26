"""Event-fed, in-memory light state.

Instead of reading variables item-by-item on every request, the store loads
every light's LIGHT_LEVEL / LIGHT_STATE with one batched director request,
then keeps them current from the WebSocket feed: any event for a light
triggers a (debounced) batched reload. Reads are served from memory.

If the WebSocket can't be started, the store degrades to a short TTL so
reads are never staler than a few seconds.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from .client import Control4Connection

log = logging.getLogger(__name__)

LIGHT_VARS = ("LIGHT_LEVEL", "LIGHT_STATE")
# Names/rooms rarely change; reload the item list occasionally.
ITEMS_TTL_SECONDS = 600
# Freshness bound when the WebSocket isn't running.
POLL_TTL_SECONDS = 5
# Even with live events, re-sync periodically to cover reconnect gaps.
LIVE_RESYNC_SECONDS = 300
# Collapse bursts of events (scenes, ramps) into one reload.
EVENT_DEBOUNCE_SECONDS = 0.25
WS_RETRY_SECONDS = 60


def _to_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class LightStore:
    def __init__(self, conn: Control4Connection) -> None:
        self._conn = conn
        self._lock = asyncio.Lock()
        self._lights: dict[int, dict[str, Any]] = {}
        self._values: dict[int, dict[str, Any]] = {}
        self._items_loaded_at = 0.0
        self._values_loaded_at = 0.0
        self._live = False
        self._ws_attempted_at = 0.0
        self._dirty = False
        self._flush_task: asyncio.Task[None] | None = None
        conn.events.subscribe(self._on_event)

    async def lights(self) -> list[dict[str, Any]]:
        """All lights with current level/state, served from memory."""
        async with self._lock:
            await self._ensure_fresh()
            return [self._row(item_id) for item_id in self._lights]

    # ------------------------------------------------------------------

    def _row(self, item_id: int) -> dict[str, Any]:
        base = self._lights[item_id]
        values = self._values.get(item_id, {})
        return {
            **base,
            "level": _to_int(values.get("LIGHT_LEVEL")),
            "state": _to_int(values.get("LIGHT_STATE")),
            "dimmable": "LIGHT_LEVEL" in values,
        }

    async def _ensure_fresh(self) -> None:
        now = time.monotonic()
        if now - self._items_loaded_at > ITEMS_TTL_SECONDS:
            await self._load_items()
            self._values_loaded_at = 0.0

        await self._ensure_live()

        age = time.monotonic() - self._values_loaded_at
        limit = LIVE_RESYNC_SECONDS if self._live else POLL_TTL_SECONDS
        if self._dirty or age > limit:
            await self._load_values()

    async def _ensure_live(self) -> None:
        if self._live:
            return
        now = time.monotonic()
        if now - self._ws_attempted_at < WS_RETRY_SECONDS:
            return
        self._ws_attempted_at = now
        try:
            await self._conn.ensure_websocket_started()
            self._live = True
        except Exception as e:  # noqa: BLE001
            log.warning("Light store falling back to polling; websocket unavailable: %s", e)

    async def _load_items(self) -> None:
        director = await self._conn.director()
        items = await director.get_all_items_by_category("lights")
        self._lights = {
            it["id"]: {
                "id": it["id"],
                "name": it.get("name"),
                "roomId": it.get("roomId"),
                "roomName": it.get("roomName"),
                "floorName": it.get("floorName"),
            }
            for it in items
            if isinstance(it.get("id"), int)
        }
        self._items_loaded_at = time.monotonic()

    async def _load_values(self) -> None:
        director = await self._conn.director()
        rows = await director.get_all_item_variable_value(LIGHT_VARS)
        values: dict[int, dict[str, Any]] = {}
        for row in rows:
            item_id = row.get("id")
            if isinstance(item_id, int) and row.get("varName") in LIGHT_VARS:
                values.setdefault(item_id, {})[row["varName"]] = row.get("value")
        self._values = values
        self._values_loaded_at = time.monotonic()
        self._dirty = False

    # ------------------------------------------------------------------
    # Event handling
    # ------------------------------------------------------------------

    def _on_event(self, item_id: int) -> None:
        if item_id not in self._lights:
            return
        self._dirty = True
        if self._flush_task is None or self._flush_task.done():
            self._flush_task = asyncio.get_running_loop().create_task(self._flush())

    async def _flush(self) -> None:
        await asyncio.sleep(EVENT_DEBOUNCE_SECONDS)
        try:
            async with self._lock:
                if self._dirty:
                    await self._load_values()
        except Exception as e:  # noqa: BLE001
            # Leave _dirty set; the next read reloads.
            log.warning("Light store event reload failed: %s", e)
