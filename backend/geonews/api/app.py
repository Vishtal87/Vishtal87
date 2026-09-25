"""HTTP API (FastAPI). Map-first product: every endpoint serves the globe UI."""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from geonews.config import settings
from geonews.api.routes import geo

log = logging.getLogger(__name__)

app = FastAPI(title="LIVE GEO NEWS API", version="0.1.0")
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["GET"], allow_headers=["*"])
app.include_router(geo.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
