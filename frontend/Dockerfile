# syntax=docker/dockerfile:1.7
# Build context: repository root.
FROM node:22-alpine AS build
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
COPY frontend/package.json frontend/pnpm-lock.yaml ./
COPY frontend/scripts ./scripts
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; npm config set cafile /run/secrets/ca; fi; \
    npm install -g pnpm@10.33.0 && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm exec vite build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
