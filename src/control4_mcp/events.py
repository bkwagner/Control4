"""In-memory bounded buffer of Control4 WebSocket events.

The WebSocket listener pushes every received item update here. Tools
read from the buffer (recent history) or await new events via `wait`.
"""

from __future__ import annotations

import asyncio
import itertools
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, Iterable

EVENT_BUFFER_DEFAULT = 500


@dataclass
class Event:
    seq: int
    ts: float  # wall-clock seconds, for "since" filters
    item_id: int
    message: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "seq": self.seq,
            "ts": self.ts,
            "item_id": self.item_id,
            "message": self.message,
        }


@dataclass
class EventBus:
    maxlen: int = EVENT_BUFFER_DEFAULT
    _buf: Deque[Event] = field(init=False)
    _seq: "itertools.count[int]" = field(init=False, default_factory=lambda: itertools.count(1))
    _signal: asyncio.Event = field(init=False, default_factory=asyncio.Event)

    def __post_init__(self) -> None:
        self._buf = deque(maxlen=self.maxlen)

    def publish(self, item_id: int, message: dict[str, Any]) -> None:
        self._buf.append(Event(seq=next(self._seq), ts=time.time(), item_id=item_id, message=message))
        # Wake all current waiters; they decide whether the new event matches.
        self._signal.set()
        self._signal.clear()

    def latest_seq(self) -> int:
        return self._buf[-1].seq if self._buf else 0

    def recent(
        self,
        *,
        since_ts: float | None = None,
        item_id: int | None = None,
        limit: int = 50,
    ) -> list[Event]:
        out: list[Event] = []
        for ev in reversed(self._buf):
            if since_ts is not None and ev.ts < since_ts:
                break
            if item_id is not None and ev.item_id != item_id:
                continue
            out.append(ev)
            if len(out) >= limit:
                break
        out.reverse()
        return out

    async def wait(
        self,
        *,
        item_ids: Iterable[int] | None = None,
        timeout: float,
    ) -> Event | None:
        """Block until a new event matching the filter arrives, or timeout."""
        deadline = time.monotonic() + timeout
        wanted = set(item_ids) if item_ids else None
        last_seen = self.latest_seq()

        while True:
            # Scan anything newer than last_seen.
            for ev in self._buf:
                if ev.seq <= last_seen:
                    continue
                if wanted is None or ev.item_id in wanted:
                    return ev
            last_seen = self.latest_seq()

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            try:
                await asyncio.wait_for(self._signal.wait(), timeout=remaining)
            except asyncio.TimeoutError:
                return None
