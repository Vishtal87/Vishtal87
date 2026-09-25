# syntax=docker/dockerfile:1.7
# Build context: repository root.  Optional BuildKit secret "ca" = extra CA bundle for corporate/sandbox proxies.

# ---- offline geographic bundle (npm registry) ----
FROM node:22-alpine AS vendor
WORKDIR /repo
COPY scripts/fetch_offline_data.sh scripts/
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then npm config set cafile /run/secrets/ca; fi; \
    sh scripts/fetch_offline_data.sh

# ---- backend ----
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1 GEONEWS_DATA_DIR=/app/data GEONEWS_CONFIG_DIR=/app/backend/config
WORKDIR /app/backend
COPY backend/pyproject.toml ./
COPY backend/geonews ./geonews
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export PIP_CERT=/run/secrets/ca; fi; \
    pip install --no-cache-dir . && python -c "import geonews, pymorphy3, lingua, trafilatura"
COPY backend/config ./config
COPY devstand /app/devstand
COPY --from=vendor /repo/data/vendor /app/data/vendor
# data/geonames exists in the image so a fresh named volume mounted there inherits the geonews owner
RUN useradd --system --uid 10001 geonews && mkdir -p /app/data/geonames && chown -R geonews /app
USER geonews
EXPOSE 8000
CMD ["python", "-m", "geonews.cli", "api", "--host", "0.0.0.0", "--port", "8000"]
