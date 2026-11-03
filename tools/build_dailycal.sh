#!/bin/sh
# Builds the page for data.dailycal.org (static/election-2026/ in dailycal-projects/dailycalprojects). It reads results
# from the Google Sheet's Page tab, so no tracker has to serve it (README, "Hosting on data.dailycal.org").
#   VITE_SHEET_URL=<Page tab's publish-to-web CSV link, or the Apps Script /exec URL> tools/build_dailycal.sh <out dir>
set -eu
out=${1:?usage: VITE_SHEET_URL=<url> tools/build_dailycal.sh <out dir>}
: "${VITE_SHEET_URL:?set VITE_SHEET_URL to the sheet link the page reads}"
export VITE_SHEET_URL
here=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$out"
out=$(cd "$out" && pwd)
rm -rf "$out/app"
(cd "$here/web" && npx tsc --noEmit && npx vite build --outDir "$out" --sourcemap false)
cp -R "$here/site/geo" "$here/site/img" "$here/site/fonts" "$here/site/measures.json" "$here/site/broadcast.json" "$out/"
echo "Built $out for $VITE_SHEET_URL"
