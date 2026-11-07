FROM node:22-bookworm-slim

COPY --from=ghcr.io/astral-sh/uv:0.9.30 /uv /usr/local/bin/uv

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    DEVICETRAIL_BACKEND_URL=http://127.0.0.1:8000 \
    DEVICETRAIL_STATE_DIR=/tmp/devicetrail

COPY pyproject.toml uv.lock ./
RUN uv sync --locked --python 3.12 --no-dev

COPY web/package.json web/package-lock.json ./web/
RUN npm ci --prefix web
COPY web ./web
RUN npm --prefix web run build -- --webpack

COPY backend ./backend
COPY start-render.sh ./
CMD ["bash", "/app/start-render.sh"]
