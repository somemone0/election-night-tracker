# Election tracker: builds the React page, then runs the poller + static server (Python stdlib only).
#   docker build -t election-tracker . && docker run -p 8080:8080 election-tracker
FROM node:22-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
COPY site/geo /src/site/geo
COPY site/img /src/site/img
COPY site/fonts /src/site/fonts
COPY site/classic.html site/measures.json site/broadcast.json /src/site/
RUN npx tsc --noEmit && npx vite build

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY tracker.py alameda_parse.py rtm.py calls.py mock_server.py rtm_sources.json ./
COPY fixtures/ fixtures/
COPY --from=web /src/site/ site/
RUN mkdir -p site/data
# Cloud Run sets PORT. RTM_CONFIG is where rtm_sources.json, rtm_manual.json and calls.json live (a mounted bucket on
# Cloud Run); all are re-read every poll, so updating them needs no redeploy.
# MOCK=1 runs a simulated election night instead of the real sources (for demos; the page says it is test data),
# starting MOCK_START minutes after polls close and advancing MOCK_SPEED simulated minutes per second.
ENV PORT=8080 RTM_CONFIG=/app INTERVAL=60 MOCK=0 MOCK_START=0 MOCK_SPEED=2
CMD if [ "$MOCK" = "1" ]; then \
      exec python3 tracker.py --serve "$PORT" --host 0.0.0.0 --interval 10 --mock --start "$MOCK_START" --speed "$MOCK_SPEED" --calls "$RTM_CONFIG/calls.json"; \
    else \
      exec python3 tracker.py --serve "$PORT" --host 0.0.0.0 --interval "$INTERVAL" \
        --rtm-sources "$RTM_CONFIG/rtm_sources.json" --rtm-manual "$RTM_CONFIG/rtm_manual.json" --calls "$RTM_CONFIG/calls.json"; \
    fi
