"""SSE endpoint. Why SSE: the flow is one-way (server -> client), works through proxies/HTTP2, the browser
reconnects automatically and resends Last-Event-ID, which we use to replay missed changes."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from geonews.api.filters import _split, _stypes, parse_bbox
from geonews.db.pool import connection
from geonews.db.repos.news_repo import change_payload
from geonews.realtime.broker import Subscription, broker

router = APIRouter(tags=["realtime"])
HEARTBEAT_S = 15


def _default(o):
    if isinstance(o, datetime):
        return o.isoformat()
    raise TypeError


def _replay(last_id: int, limit: int = 300) -> list[dict]:
    with connection() as conn:
        rows = conn.execute(
            "SELECT id, event_id, op FROM event_change_log WHERE id > %s ORDER BY id LIMIT %s", (last_id, limit)
        ).fetchall()
        out = []
        for r in rows:
            p = change_payload(conn, r["event_id"])
            if p:
                out.append({"log_id": r["id"], "op": r["op"], **p})
        return out


def _last_log_id() -> int:
    with connection() as conn:
        return conn.execute("SELECT coalesce(max(id), 0) m FROM event_change_log").fetchone()["m"]


@router.get("/api/stream")
async def stream(
    request: Request,
    bbox: str | None = None,
    cats: str | None = None,
    sources: str | None = None,
    place: int | None = None,
    since: int | None = Query(None, description="replay changes after this log id"),
    last_event_id: str | None = Header(None),
):
    sub = broker.subscribe(Subscription(boxes=parse_bbox(bbox), cats=_split(cats), stypes=_stypes(sources),
                                        place_id=place))
    start_after = since if since is not None else (int(last_event_id) if last_event_id and last_event_id.isdigit() else None)

    async def gen():
        try:
            head = await run_in_threadpool(_last_log_id)
            yield f"retry: 3000\nevent: hello\ndata: {json.dumps({'last_log_id': head})}\n\n"
            sent = start_after or head
            if start_after is not None:
                for ev in await run_in_threadpool(_replay, start_after):
                    if sub.matches(ev):
                        sent = ev["log_id"]
                        yield f"id: {ev['log_id']}\nevent: event\ndata: {json.dumps(ev, default=_default)}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(sub.queue.get(), timeout=HEARTBEAT_S)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                if ev["log_id"] <= sent:
                    continue  # already delivered by the replay
                sent = ev["log_id"]
                yield f"id: {ev['log_id']}\nevent: event\ndata: {json.dumps(ev, default=_default)}\n\n"
        finally:
            broker.unsubscribe(sub)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"})
