"""Client for DirectorLink (formerly C4Bridge), a DriverWorks driver running
on the Director that serves a normalized LAN API
(github.com/IsraelCIL/DirectorLink, OpenAPI at /v1/openapi.json).

Used for the device types it supports (lights, thermostats, fans, blinds,
alarm status) because it needs no Control4 cloud login: state is kept in
memory on the Director and fed by variable listeners. Callers fall back to
the direct Director path when DirectorLink is unavailable or doesn't know a
device (LinkUnavailable); requests it rejects as invalid (LinkRequestError)
are reported as-is.

All temperatures in the API are degrees Celsius.
"""

from __future__ import annotations

import logging
from typing import Any

import aiohttp

log = logging.getLogger(__name__)

# Collections served as GET /v1/<kind> -> {"items": [...]}.
KINDS = ("lights", "thermostats", "fans", "blinds")


class LinkUnavailable(Exception):
    """DirectorLink can't serve this request; use the Director path."""


class LinkRequestError(Exception):
    """DirectorLink refused the request itself (invalid value, unsupported on
    this device). Retrying elsewhere won't help."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code


class DirectorLinkClient:
    def __init__(self, base_url: str, api_key: str, timeout: float = 5.0) -> None:
        self._base = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {api_key}"}
        self._timeout = aiohttp.ClientTimeout(total=timeout)
        self._session: aiohttp.ClientSession | None = None

    async def close(self) -> None:
        if self._session is not None and not self._session.closed:
            await self._session.close()
        self._session = None

    async def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=self._timeout)
        try:
            async with self._session.request(method, self._base + path, headers=self._headers, json=body) as resp:
                try:
                    data = await resp.json(content_type=None)
                except ValueError:
                    data = None
                status = resp.status
        except (aiohttp.ClientError, TimeoutError) as e:
            raise LinkUnavailable(f"DirectorLink unreachable: {e}") from e

        if status < 400:
            return data
        problem = data if isinstance(data, dict) else {}
        code = str(problem.get("code") or status)
        detail = str(problem.get("detail") or problem.get("title") or "request failed")
        if status == 401:
            raise LinkUnavailable(
                f"DirectorLink refused the API key ({code}); pair again and update CONTROL4_DIRECTORLINK_TOKEN"
            )
        if code == "SEALED_REQUEST_REQUIRED":
            # By design DirectorLink only answers this (alarm status) end-to-end
            # encrypted via POST /v1/sealed; use the Director path instead.
            raise LinkUnavailable(f"DirectorLink requires a sealed request: {detail}")
        # Unknown device / route, or the controller couldn't run the command.
        if status == 404 or status >= 500:
            raise LinkUnavailable(f"DirectorLink can't handle this: {code}: {detail}")
        raise LinkRequestError(code, detail)

    async def items(self, kind: str) -> list[dict[str, Any]]:
        """Devices of one kind: lights, thermostats, fans, blinds."""
        if kind not in KINDS:
            raise ValueError(kind)
        data = await self._request("GET", f"/v1/{kind}")
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list):
            # Not the DirectorLink API (e.g. a pre-rename C4Bridge build).
            raise LinkUnavailable(f"unexpected /v1/{kind} response from DirectorLink")
        return items

    async def get(self, kind: str, item_id: int) -> dict[str, Any]:
        return await self._request("GET", f"/v1/{kind}/{item_id}") or {}

    async def patch(self, kind: str, item_id: int, changes: dict[str, Any]) -> dict[str, Any]:
        return await self._request("PATCH", f"/v1/{kind}/{item_id}", changes) or {}

    async def stop_blind(self, item_id: int) -> dict[str, Any]:
        return await self._request("POST", f"/v1/blinds/{item_id}/stop") or {}

    async def alarm(self) -> dict[str, Any]:
        return await self._request("GET", "/v1/alarm") or {}
