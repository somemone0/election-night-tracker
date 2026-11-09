#!/bin/sh
# Builds the tracker and broadcast pages to be hosted apart from the tracker: on data.dailycal.org
# (static/election-2026/ in dailycal-projects/dailycalprojects), or anywhere else, e.g. the broadcast machine. The pages
# read results from the tracker's API, the tracker on Cloud Run (README, "Hosting on data.dailycal.org").
#   VITE_API_BASE=https://<tracker>/ tools/build_dailycal.sh <out dir>
set -eu
out=${1:?usage: VITE_API_BASE=https://<tracker>/ tools/build_dailycal.sh <out dir>}
: "${VITE_API_BASE:?set VITE_API_BASE to the tracker the pages read, ending in /}"
case "$VITE_API_BASE" in */) ;; *) VITE_API_BASE="$VITE_API_BASE/" ;; esac
export VITE_API_BASE
here=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$out"
out=$(cd "$out" && pwd)
rm -rf "$out/app"
(cd "$here/web" && npx tsc --noEmit && npx vite build --outDir "$out" --sourcemap false)
cp -R "$here/site/geo" "$here/site/img" "$here/site/fonts" "$here/site/measures.json" "$here/site/broadcast.json" "$out/"
echo "Built $out, reading results from ${VITE_API_BASE}data/"
