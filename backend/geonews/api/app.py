"""HTTP API (FastAPI). Map-first product: every endpoint serves the globe UI."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from geonews.api.routes import events, geo, map as map_routes, meta, places, stream, tiles
from geonews.config import settings
from geonews.realtime.broker import broker

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    broker.start()
    yield
    await broker.stop()


app = FastAPI(title="LIVE GEO NEWS API", version="0.1.0", lifespan=lifespan)
# NOTE: no GZip middleware globally — it would buffer the SSE stream. Responses are compressed by the reverse proxy.
app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["GET"], allow_headers=["*"],
                   expose_headers=["*"])
for r in (geo.router, map_routes.router, places.router, events.router, stream.router, tiles.router, meta.router):
    app.include_router(r)
