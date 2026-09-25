"""Realtime fan-out: one LISTEN connection per API process -> filtered SSE subscribers.

Workers commit an event change and NOTIFY 'event_changes' in the same transaction, so clients never see
an event before it is readable through the REST API.
"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field

import psycopg

from geonews.config import settings

log = logging.getLogger(__name__)


@dataclass(eq=False)
class Subscription:
    boxes: list[tuple[float, float, float, float]] | None = None
    cats: list[str] | None = None
    stypes: list[str] | None = None
    place_id: int | None = None
    include_synthetic: bool = True
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=500))
    dropped: int = 0

    def matches(self, ev: dict) -> bool:
        if ev.get("status") not in (None, "active"):
            return True  # removals/merges are always relevant to clients that may display them
        if not self.include_synthetic and ev.get("synthetic"):
            return False
        if self.cats and ev.get("category") not in self.cats:
            return False
        if self.stypes and not set(self.stypes) & set(ev.get("source_types") or []):
            return False
        if self.place_id and self.place_id not in (ev.get("ancestors") or []):
            return False
        if self.boxes:
            lat, lon = ev.get("lat"), ev.get("lon")
            if lat is None or not any(w <= lon <= e and s <= lat <= n for w, s, e, n in self.boxes):
                return False
        return True


class Broker:
    def __init__(self) -> None:
        self.subs: set[Subscription] = set()
        self._task: asyncio.Task | None = None
        self.connected = False
        self.delivered = 0

    def subscribe(self, sub: Subscription) -> Subscription:
        self.subs.add(sub)
        return sub

    def unsubscribe(self, sub: Subscription) -> None:
        self.subs.discard(sub)

    def publish(self, ev: dict) -> None:
        for s in list(self.subs):
            if s.matches(ev):
                if s.queue.full():  # slow client: drop the oldest, it will refetch on 'lag'
                    s.queue.get_nowait()
                    s.dropped += 1
                s.queue.put_nowait(ev)
                self.delivered += 1

    async def run(self) -> None:
        backoff = 1.0
        while True:
            try:
                async with await psycopg.AsyncConnection.connect(settings.dsn, autocommit=True) as conn:
                    await conn.execute("LISTEN event_changes")
                    self.connected = True
                    backoff = 1.0
                    log.info("realtime broker listening")
                    async for n in conn.notifies():
                        try:
                            self.publish(json.loads(n.payload))
                        except (ValueError, TypeError):
                            log.warning("bad notify payload")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.connected = False
                log.warning("broker connection lost (%s); retrying in %.0fs", e, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self.run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()


broker = Broker()
