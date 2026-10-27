# Election tracker: builds the React page, then runs the poller + static server (Python stdlib only).
#   docker build -t election-tracker . && docker run -p 8080:8080 election-tracker
FROM node:22-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
COPY site/geo /src/site/geo
COPY site/img /src/site/img
COPY site/classic.html /src/site/classic.html
RUN npx tsc --noEmit && npx vite build

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY tracker.py alameda_parse.py rtm.py mock_server.py rtm_sources.json ./
COPY fixtures/ fixtures/
COPY --from=web /src/site/ site/
RUN mkdir -p site/data
# Cloud Run sets PORT. RTM_CONFIG is where rtm_sources.json and rtm_manual.json live (a mounted bucket on Cloud Run);
# both are re-read every poll, so updating them needs no redeploy.
ENV PORT=8080 RTM_CONFIG=/app INTERVAL=60
CMD exec python3 tracker.py --serve "$PORT" --host 0.0.0.0 --interval "$INTERVAL" \
    --rtm-sources "$RTM_CONFIG/rtm_sources.json" --rtm-manual "$RTM_CONFIG/rtm_manual.json"
