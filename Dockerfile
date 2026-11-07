FROM node:22-bookworm-slim

COPY --from=ghcr.io/astral-sh/uv:0.9.30 /uv /usr/local/bin/uv

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV DEVICETRAIL_BACKEND_URL=http://127.0.0.1:8000

COPY pyproject.toml uv.lock ./
RUN uv sync --locked --python 3.12 --no-dev

COPY backend ./backend
COPY web ./web
RUN cd web && npm ci && npm run build

COPY start-render.sh ./
CMD ["bash", "/app/start-render.sh"]