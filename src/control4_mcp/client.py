"""Control4 connection manager.

Wraps pyControl4's account/director auth flow and exposes a single
authenticated director we can reuse across MCP tool calls. Handles
token refresh transparently.

Also manages an optional WebSocket listener that fans out per-item events
into an EventBus.
"""

from __future__ import annotations

import asyncio
import logging
import ssl
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import aiohttp
from pyControl4.account import C4Account
from pyControl4.director import C4Director
from pyControl4.websocket import C4Websocket

from .config import Settings
from .events import EventBus

log = logging.getLogger(__name__)

# Refresh a bit before the director-reported expiry to avoid mid-call failure.
REFRESH_MARGIN_SECONDS = 5 * 60


class Control4Connection:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._session: aiohttp.ClientSession | None = None
        self._director: C4Director | None = None
        self._director_token: str | None = None
        self._token_expires_at: float = 0.0
        self._lock = asyncio.Lock()

        self.events = EventBus()
        self._ws: C4Websocket | None = None
        self._ws_started = False
        self._ws_lock = asyncio.Lock()

    async def close(self) -> None:
        if self._ws is not None:
            try:
                await self._ws.sio_disconnect()
            except Exception as e:  # noqa: BLE001
                log.warning("Error disconnecting websocket: %s", e)
            self._ws = None
            self._ws_started = False
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
            # Control4 directors present a self-signed cert on the LAN.
            # The cloud endpoints have valid certs, but disabling verification
            # on one shared session is simpler than juggling two.
            ssl_ctx = ssl.create_default_context()
            ssl_ctx.check_hostname = False
            ssl_ctx.verify_mode = ssl.CERT_NONE
            connector = aiohttp.TCPConnector(ssl=ssl_ctx)
            self._session = aiohttp.ClientSession(connector=connector)

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
        self._director_token = token_payload["token"]
        valid_seconds = int(token_payload.get("validSeconds", 86400))

        self._director = C4Director(
            self._settings.director_ip,
            self._director_token,
            self._session,
        )
        self._token_expires_at = time.monotonic() + valid_seconds

    # ------------------------------------------------------------------
    # WebSocket lifecycle
    # ------------------------------------------------------------------

    async def ensure_websocket_started(self) -> None:
        """Start the WebSocket listener (idempotent).

        Registers a per-item callback on every item currently in the project
        so that every state change lands in `self.events`.
        """
        async with self._ws_lock:
            if self._ws_started:
                return
            director = await self.director()
            assert self._director_token is not None

            self._ws = C4Websocket(
                self._settings.director_ip,
                connect_callback=self._on_ws_connect,
                disconnect_callback=self._on_ws_disconnect,
            )

            items = await director.get_all_item_info()
            registered = 0
            for it in items:
                item_id = it.get("id")
                if isinstance(item_id, int):
                    self._ws.add_item_callback(item_id, self._make_item_handler(item_id))
                    registered += 1

            await self._ws.sio_connect(self._director_token)
            self._ws_started = True
            log.info("Websocket started; subscribed to %d items", registered)

    def _make_item_handler(self, item_id: int):
        async def handler(device_id: int, message: dict[str, Any]) -> None:
            self.events.publish(device_id, message)

        return handler

    async def _on_ws_connect(self, *_: Any, **__: Any) -> None:
        log.info("Control4 websocket connected")

    async def _on_ws_disconnect(self, *_: Any, **__: Any) -> None:
        log.warning("Control4 websocket disconnected")


@asynccontextmanager
async def connection(settings: Settings) -> AsyncIterator[Control4Connection]:
    conn = Control4Connection(settings)
    try:
        yield conn
    finally:
        await conn.close()
