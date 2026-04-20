"""Control4 connection manager.

Wraps pyControl4's account/director auth flow and exposes a single
authenticated director we can reuse across MCP tool calls. Handles
token refresh transparently.
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator

import aiohttp
from pyControl4.account import C4Account
from pyControl4.director import C4Director

from .config import Settings

log = logging.getLogger(__name__)

# Refresh a bit before the director-reported expiry to avoid mid-call failure.
REFRESH_MARGIN_SECONDS = 5 * 60


class Control4Connection:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._session: aiohttp.ClientSession | None = None
        self._director: C4Director | None = None
        self._token_expires_at: float = 0.0
        self._lock = asyncio.Lock()

    async def close(self) -> None:
        if self._session is not None and not self._session.closed:
            await self._session.close()
        self._session = None
        self._director = None

    async def director(self) -> C4Director:
        async with self._lock:
            if self._director is None or self._token_expired():
                await self._connect()
            assert self._director is not None
            return self._director

    def _token_expired(self) -> bool:
        return time.monotonic() >= (self._token_expires_at - REFRESH_MARGIN_SECONDS)

    async def _connect(self) -> None:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()

        account = C4Account(
            self._settings.account_email,
            self._settings.account_password,
            self._session,
        )
        await account.get_account_bearer_token()

        common_name = self._settings.controller_common_name
        if not common_name:
            controllers = await account.get_account_controllers()
            common_name = controllers["controllerCommonName"]
            log.info("Auto-selected controller: %s", common_name)

        token_payload = await account.get_director_bearer_token(common_name)
        director_token = token_payload["token"]
        valid_seconds = int(token_payload.get("validSeconds", 86400))

        self._director = C4Director(
            self._settings.director_ip,
            director_token,
            self._session,
        )
        self._token_expires_at = time.monotonic() + valid_seconds


@asynccontextmanager
async def connection(settings: Settings) -> AsyncIterator[Control4Connection]:
    conn = Control4Connection(settings)
    try:
        yield conn
    finally:
        await conn.close()
