"""Client for C4Bridge, a DriverWorks driver running on the Director that
serves a normalized LAN API (github.com/IsraelCIL/C4Bridge).

Used for the device types it supports (lights, thermostats, fans, blinds,
security status) because it needs no Control4 cloud login: state is kept in
memory on the Director and fed by variable listeners. Callers fall back to
the direct Director path when the bridge is unavailable or doesn't know a
device (BridgeUnavailable); invalid requests (BridgeActionError) are
reported as-is.
"""

from __future__ import annotations

import logging
from typing import Any

import aiohttp

log = logging.getLogger(__name__)

# Collection name in the API response for each device kind.
_LISTS = {
    "lights": "lights",
    "climate": "climate",
    "fans": "fans",
    "covers": "covers",
    "security": "security",
}

# Action errors that mean "not a bridge device" -> use the Director instead.
_FALLBACK_CODES = {"DEVICE_NOT_FOUND", "DEVICE_NOT_SUPPORTED"}


class BridgeUnavailable(Exception):
    """The bridge can't serve this request; use the Director path."""


class BridgeActionError(Exception):
    """The bridge rejected the request itself (invalid value, unsupported
    action on a supported device). Retrying elsewhere won't help."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code


class C4BridgeClient:
    def __init__(self, base_url: str, token: str, timeout: float = 5.0) -> None:
        self._base = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"}
        self._timeout = aiohttp.ClientTimeout(total=timeout)
        self._session: aiohttp.ClientSession | None = None

    async def close(self) -> None:
        if self._session is not None and not self._session.closed:
            await self._session.close()
        self._session = None

    async def _request(self, method: str, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=self._timeout)
        try:
            async with self._session.request(
                method, self._base + path, headers=self._headers, params=params
            ) as resp:
                try:
                    body = await resp.json(content_type=None)
                except ValueError:
                    body = {}
                status = resp.status
        except (aiohttp.ClientError, TimeoutError) as e:
            raise BridgeUnavailable(f"C4Bridge unreachable: {e}") from e

        if status < 400:
            return body if isinstance(body, dict) else {}
        error = (body or {}).get("error") or {}
        code = str(error.get("code") or status)
        message = str(error.get("message") or "request failed")
        if status in (401, 403):
            raise BridgeUnavailable(f"C4Bridge rejected the token ({code}); re-pair and update CONTROL4_C4BRIDGE_TOKEN")
        if code in _FALLBACK_CODES or (status == 404 and code == "NOT_FOUND") or status >= 500:
            raise BridgeUnavailable(f"C4Bridge can't handle this: {code}: {message}")
        raise BridgeActionError(code, message)

    async def devices(self, kind: str) -> list[dict[str, Any]]:
        """Supported devices of one kind: lights, climate, fans, covers, security."""
        body = await self._request("GET", f"/v1/{kind}")
        items = body.get(_LISTS[kind])
        # The driver's JSON encoder turns an empty Lua table into {}.
        return items if isinstance(items, list) else []

    async def device(self, kind: str, item_id: int) -> dict[str, Any]:
        for item in await self.devices(kind):
            if item.get("id") == item_id:
                return item
        raise BridgeUnavailable(f"item {item_id} is not a C4Bridge {kind} device")

    async def action(self, item_id: int, action: str, **params: Any) -> dict[str, Any]:
        query = {k: str(v) for k, v in params.items() if v is not None}
        return await self._request("POST", f"/v1/devices/{item_id}/actions/{action}", query or None)
