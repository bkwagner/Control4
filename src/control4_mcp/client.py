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
        # Cloud endpoints (apis.control4.com) have real certs and receive the
        # account password, so they get a normal verifying session. Only the
        # LAN director (self-signed cert) uses the no-verify session.
        self._cloud_session: aiohttp.ClientSession | None = None
        self._director_session: aiohttp.ClientSession | None = None
        self._director: C4Director | None = None
        self._director_token: str | None = None
        self._token_expires_at: float = 0.0
        self._lock = asyncio.Lock()

        self.events = EventBus()
        self._ws: C4Websocket | None = None
        self._ws_started = False
        self._ws_lock = asyncio.Lock()
        self._ws_item_ids: set[int] = set()
        self._refresh_task: asyncio.Task[None] | None = None

    async def close(self) -> None:
        if self._refresh_task is not None:
            self._refresh_task.cancel()
            self._refresh_task = None
        if self._ws is not None:
            try:
                await self._ws.sio_disconnect()
            except Exception as e:  # noqa: BLE001
                log.warning("Error disconnecting websocket: %s", e)
            self._ws = None
            self._ws_started = False
            self._ws_item_ids.clear()
        for session in (self._cloud_session, self._director_session):
            if session is not None and not session.closed:
                await session.close()
        self._cloud_session = None
        self._director_session = None
        self._director = None

    async def director(self) -> C4Director:
        async with self._lock:
            if self._director is None or self._token_expired():
                await self._connect()
                # A live websocket keeps using the token it connected with and
                # the director stops sending events once that token expires.
                if self._ws_started and self._ws is not None:
                    assert self._director_token is not None
                    await self._ws.sio_connect(self._director_token)
                    log.info("Websocket reconnected with refreshed token")
            assert self._director is not None
            return self._director

    def _token_expired(self) -> bool:
        return time.monotonic() >= (self._token_expires_at - REFRESH_MARGIN_SECONDS)

    def _ensure_sessions(self) -> None:
        if self._cloud_session is None or self._cloud_session.closed:
            self._cloud_session = aiohttp.ClientSession()
        if self._director_session is None or self._director_session.closed:
            ssl_ctx = ssl.create_default_context()
            ssl_ctx.check_hostname = False
            ssl_ctx.verify_mode = ssl.CERT_NONE
            self._director_session = aiohttp.ClientSession(
                connector=aiohttp.TCPConnector(ssl=ssl_ctx)
            )

    async def _connect(self) -> None:
        self._ensure_sessions()

        # Control4's cloud auth endpoint occasionally disconnects mid-handshake.
        # Retry on transient network errors; real auth failures bubble up.
        async def _cloud_auth() -> tuple[str, int]:
            account = C4Account(
                self._settings.account_email,
                self._settings.account_password,
                self._cloud_session,
            )
            await account.get_account_bearer_token()

            common_name = self._settings.controller_common_name
            if not common_name:
                controllers = await account.get_account_controllers()
                common_name = controllers["controllerCommonName"]
                log.info("Auto-selected controller: %s", common_name)

            payload = await account.get_director_bearer_token(common_name)
            return payload["token"], int(payload.get("validSeconds", 86400))

        last_err: Exception | None = None
        for attempt in range(3):
            try:
                token, valid_seconds = await _cloud_auth()
                break
            except (aiohttp.ClientConnectionError, aiohttp.ServerDisconnectedError) as e:
                last_err = e
                delay = 0.5 * (2**attempt)
                log.warning("Cloud auth attempt %d failed (%s); retrying in %.1fs", attempt + 1, e, delay)
                await asyncio.sleep(delay)
        else:
            assert last_err is not None
            raise last_err

        self._director_token = token
        self._director = C4Director(
            self._settings.director_ip,
            self._director_token,
            self._director_session,
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
                session_no_verify_ssl=self._director_session,
                connect_callback=self._on_ws_connect,
                disconnect_callback=self._on_ws_disconnect,
            )
            await self._subscribe_new_items(director)

            await self._ws.sio_connect(self._director_token)
            self._ws_started = True
            log.info("Websocket started; subscribed to %d items", len(self._ws_item_ids))

            # Keep the token (and therefore the websocket) fresh even when no
            # tool calls arrive to trigger a lazy refresh.
            if self._refresh_task is None:
                self._refresh_task = asyncio.create_task(self._token_refresh_loop())

    async def _subscribe_new_items(self, director: C4Director) -> None:
        assert self._ws is not None
        items = await director.get_all_item_info()
        for it in items:
            item_id = it.get("id")
            if isinstance(item_id, int) and item_id not in self._ws_item_ids:
                self._ws.add_item_callback(item_id, self._make_item_handler(item_id))
                self._ws_item_ids.add(item_id)

    async def _token_refresh_loop(self) -> None:
        while True:
            wait = self._token_expires_at - REFRESH_MARGIN_SECONDS - time.monotonic()
            await asyncio.sleep(max(30.0, wait + 1))
            try:
                director = await self.director()
                # Pick up items added to the project since the last refresh.
                if self._ws is not None:
                    await self._subscribe_new_items(director)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                log.warning("Background token refresh failed: %s", e)

    def _make_item_handler(self, item_id: int):
        async def handler(device_id: int, message: dict[str, Any]) -> None:
            self.events.publish(device_id, message)

        return handler

    async def _on_ws_connect(self, *_: Any, **__: Any) -> None:
        log.info("Control4 websocket connected")

    async def _on_ws_disconnect(self, *_: Any, **__: Any) -> None:
        # python-socketio reconnects automatically; token refresh above
        # handles the case where the reconnect would use an expired token.
        log.warning("Control4 websocket disconnected")


@asynccontextmanager
async def connection(settings: Settings) -> AsyncIterator[Control4Connection]:
    conn = Control4Connection(settings)
    try:
        yield conn
    finally:
        await conn.close()
