"""FastAPI REST layer for the Control4 desktop app.

Mounted at /api on the same uvicorn instance as the MCP SSE server.
Frontend-agnostic: just HTTP + JSON. If we ever rewrite the backend in
Node, the Electron app keeps working as long as the routes match.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pyControl4.climate import C4Climate
from pyControl4.light import C4Light
from pyControl4.room import C4Room
from pydantic import BaseModel

from .client import Control4Connection


class LightLevelPayload(BaseModel):
    level: int


class ClimatePayload(BaseModel):
    heat_setpoint_f: float | None = None
    cool_setpoint_f: float | None = None
    hvac_mode: str | None = None


class VolumePayload(BaseModel):
    volume: int


class SourcePayload(BaseModel):
    source_id: int


def create_api(conn: Control4Connection) -> FastAPI:
    app = FastAPI(title="Control4 App API", version="0.1.0")

    # Electron loads over file:// in prod and http://localhost:5173 in dev.
    # Permissive CORS is fine because the API only binds to localhost.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    # ------------------------------------------------------------------
    # Rooms
    # ------------------------------------------------------------------

    @app.get("/rooms")
    async def list_rooms() -> list[dict[str, Any]]:
        director = await conn.director()
        items = await director.get_all_item_info()
        return [
            {
                "id": it.get("id"),
                "name": it.get("name"),
                "floorName": it.get("floorName"),
                "floorId": it.get("floorId"),
            }
            for it in items
            if it.get("typeName") == "room"
        ]

    @app.post("/rooms/{room_id}/off")
    async def room_off(room_id: int) -> dict[str, Any]:
        director = await conn.director()
        await C4Room(director, room_id).set_room_off()
        return {"ok": True, "room_id": room_id}

    # ------------------------------------------------------------------
    # Items + lights
    # ------------------------------------------------------------------

    @app.get("/items")
    async def list_items(category: str | None = None) -> list[dict[str, Any]]:
        director = await conn.director()
        items = (
            await director.get_all_items_by_category(category)
            if category
            else await director.get_all_item_info()
        )
        return [
            {
                "id": it.get("id"),
                "name": it.get("name"),
                "typeName": it.get("typeName"),
                "categories": it.get("categories") or [],
                "roomId": it.get("roomId"),
                "roomName": it.get("roomName"),
                "floorName": it.get("floorName"),
                "proxy": it.get("proxy"),
            }
            for it in items
        ]

    @app.get("/items/{item_id}/variables")
    async def get_item_variables(item_id: int) -> list[dict[str, Any]]:
        director = await conn.director()
        return await director.get_item_variables(item_id)

    @app.get("/lights")
    async def list_lights() -> list[dict[str, Any]]:
        """All lights with their current LIGHT_LEVEL and LIGHT_STATE in one call."""
        director = await conn.director()
        lights = await director.get_all_items_by_category("lights")
        out: list[dict[str, Any]] = []
        for it in lights:
            item_id = it.get("id")
            level: int | None = None
            state: int | None = None
            dimmable = False
            try:
                variables = await director.get_item_variables(item_id)
                for v in variables:
                    name = v.get("varName")
                    if name == "LIGHT_LEVEL":
                        level = int(v.get("value")) if v.get("value") is not None else None
                        dimmable = True
                    elif name == "LIGHT_STATE":
                        state = int(v.get("value")) if v.get("value") is not None else None
            except Exception:  # noqa: BLE001
                pass
            out.append(
                {
                    "id": item_id,
                    "name": it.get("name"),
                    "roomId": it.get("roomId"),
                    "roomName": it.get("roomName"),
                    "floorName": it.get("floorName"),
                    "level": level,
                    "state": state,
                    "dimmable": dimmable,
                }
            )
        return out

    @app.post("/lights/{item_id}/level")
    async def set_light_level(item_id: int, payload: LightLevelPayload) -> dict[str, Any]:
        level = max(0, min(100, int(payload.level)))
        director = await conn.director()
        await C4Light(director, item_id).set_level(level)
        return {"ok": True, "item_id": item_id, "level": level}

    # ------------------------------------------------------------------
    # Climate
    # ------------------------------------------------------------------

    @app.get("/climate")
    async def list_climate() -> list[dict[str, Any]]:
        director = await conn.director()
        items = await director.get_all_items_by_category("comfort")
        return [
            {
                "id": it.get("id"),
                "name": it.get("name"),
                "roomId": it.get("roomId"),
                "roomName": it.get("roomName"),
            }
            for it in items
        ]

    @app.post("/climate/{item_id}")
    async def set_climate(item_id: int, payload: ClimatePayload) -> dict[str, Any]:
        director = await conn.director()
        climate = C4Climate(director, item_id)
        applied: dict[str, Any] = {}
        if payload.heat_setpoint_f is not None:
            await climate.set_heat_setpoint_f(float(payload.heat_setpoint_f))
            applied["heat_setpoint_f"] = payload.heat_setpoint_f
        if payload.cool_setpoint_f is not None:
            await climate.set_cool_setpoint_f(float(payload.cool_setpoint_f))
            applied["cool_setpoint_f"] = payload.cool_setpoint_f
        if payload.hvac_mode is not None:
            await climate.set_hvac_mode(payload.hvac_mode)
            applied["hvac_mode"] = payload.hvac_mode
        if not applied:
            raise HTTPException(400, "must provide at least one climate field")
        return {"ok": True, "item_id": item_id, **applied}

    # ------------------------------------------------------------------
    # Audio/Video
    # ------------------------------------------------------------------

    _SOURCE_PROXIES = {
        "media_service",
        "tv",
        "cable",
        "cd",
        "dvd",
        "control4_network_mediastorage",
    }

    @app.get("/av/sources")
    async def list_av_sources() -> list[dict[str, Any]]:
        director = await conn.director()
        items = await director.get_all_items_by_category("audio_video")
        return [
            {
                "id": it.get("id"),
                "name": it.get("name"),
                "proxy": it.get("proxy"),
                "roomName": it.get("roomName"),
            }
            for it in items
            if (it.get("proxy") or "") in _SOURCE_PROXIES
            or str(it.get("proxy") or "").startswith("rf_")
        ]

    @app.get("/av/rooms/{room_id}")
    async def room_av_state(room_id: int) -> dict[str, Any]:
        director = await conn.director()
        room = C4Room(director, room_id)
        return {
            "room_id": room_id,
            "is_on": await room.is_on(),
            "volume": await room.get_volume(),
            "muted": await room.is_muted(),
        }

    @app.post("/av/rooms/{room_id}/volume")
    async def set_room_volume(room_id: int, payload: VolumePayload) -> dict[str, Any]:
        volume = max(0, min(100, int(payload.volume)))
        director = await conn.director()
        await C4Room(director, room_id).set_volume(volume)
        return {"ok": True, "room_id": room_id, "volume": volume}

    @app.post("/av/rooms/{room_id}/mute/toggle")
    async def toggle_room_mute(room_id: int) -> dict[str, Any]:
        director = await conn.director()
        await C4Room(director, room_id).toggle_mute()
        return {"ok": True, "room_id": room_id}

    @app.post("/av/rooms/{room_id}/audio-source")
    async def set_audio_source(room_id: int, payload: SourcePayload) -> dict[str, Any]:
        director = await conn.director()
        await C4Room(director, room_id).set_audio_source(int(payload.source_id))
        return {"ok": True, "room_id": room_id, "source_id": payload.source_id}

    @app.post("/av/rooms/{room_id}/video-source")
    async def set_video_source(room_id: int, payload: SourcePayload) -> dict[str, Any]:
        director = await conn.director()
        await C4Room(director, room_id).set_video_and_audio_source(int(payload.source_id))
        return {"ok": True, "room_id": room_id, "source_id": payload.source_id}

    for verb in ("play", "pause", "stop"):

        def _make_handler(action: str):
            async def handler(room_id: int) -> dict[str, Any]:
                director = await conn.director()
                room = C4Room(director, room_id)
                await getattr(room, f"set_{action}")()
                return {"ok": True, "room_id": room_id, "action": action}

            return handler

        app.post(f"/av/rooms/{{room_id}}/{verb}")(_make_handler(verb))

    return app
