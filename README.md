# Election night tracker: Prop 40, Alameda County, Berkeley

Polls two public sources, writes JSON/CSV, and renders a static page styled after data.dailycal.org
(off-white page, Georgia text in a narrow column, dark/light blue Datawrapper-style bars).

| Data | Source | How |
|---|---|---|
| Prop 40, all statewide measures and the governor race, statewide and Alameda County | CA Secretary of State Election Night feed, `https://api.sos.ca.gov/returns/ballot-measures`, `/returns/governor` (each also under `/county/alameda`) | JSON, no key |
| County, Berkeley and district contests (RCV first choices included) | Alameda Registrar results page, `https://alamedacountyca.gov/rovresults/262/` | HTML parsed with the stdlib |

Prop 40 in Alameda County comes from both sources, and the tracker flags it if they disagree.

The page is a zoomable map on the left and results on the right. There are four levels, and zooming moves
between them (clicking an area or using the buttons above the map works too):

| Level | MapLibre zoom (on a ~1000 px map) | Results shown |
|---|---|---|
| City (Berkeley) | above 11.5 | the city's measures and races, plus RTM and Prop 40 |
| Congress (districts 10, 12, 14, 17) | 9.5-11.5 | the House race, plus RTM and Prop 40 |
| County (Alameda) | 7.5-9.5 | turnout, RTM, governor, countywide races and measures |
| State (California) | 7.5 and wider | Prop 40 in full (with chart), governor, other statewide measures |

The level changes once the zoom has moved 0.75 or more since the last change, or when the centre leaves the area,
so small zooms and pans never flip it back and forth. Over water, the nearest area counts.

## The frontend (React)

`web/` is a React 18 + TypeScript app built with Vite into `site/` (`site/index.html` + `site/app/`). The tracker
serves it as before. `site/classic.html` is the previous single-file page, kept as a fallback.

```sh
cd web
npm install          # once
npm run build        # typecheck + build into ../site (run after any change in web/)
npm test             # vitest: zoom levels, which cards show, card layout
npm run dev          # live-reloading page on :5173; needs `python3 tracker.py --serve 8077` running for the data
```

How it stays stable on election night:
* **Data:** one request at a time, a 10 s timeout, a shape check before new numbers replace the old ones, retries
  with backoff, and a refresh when the tab comes back into view. A failed poll keeps the last good numbers on screen
  with a banner. Error boundaries keep a broken map or race from taking down the rest of the page.
* **Map:** MapLibre GL draws every boundary on the GPU (no SVG redraws), and the map is created once. Cards follow
  the map in the same frame it draws, and only re-lay out once it stops, so nothing flashes or lags.

How levels transition:
* **Map:** finer boundaries fade in with zoom. The raised "area in view" cross-fades from the old area to the new one.
* **Cards:** cards that stay keep their place. Going from district to city, Berkeley's stacked cluster card opens into
  its races (they fly out of it); going back, they fly into it. New cards wait until a camera move finishes, then
  animate into their laid-out spots.
* **Results card:** the old panel slides out as the new one slides in, up when zooming in and down when zooming out.

Code map: `src/lib/` (pure logic: geometry, zoom bands, which cards show, card layout), `src/map/` (MapLibre layers,
card layer), `src/panels/` and `src/components/` (results), `src/hooks/` (data loading), `src/config.ts` (settings).

Race cards sit on the map, styled after meetvc.cafe's café cards: a white card per race with the candidates' headshot
tiles (leader outlined), and a black chip with the leader's margin in points; the card line gives the vote lead, and an
amber ring marks races within 3 points. Cards anchor to the area a race covers (California, the county, the House
district, the city, or one of Berkeley's eight council districts). Zoomed out, each city's races fold into one stacked
"cluster" card with a "×N" badge (at district level, one per city in the district; at county level, Berkeley's). Cards
slide sideways, stack, or drop below their point so they never overlap; clicking one jumps to the race (or zooms into
the city). Headshots come from `site/img/headshots/<first-last>.png`; anyone without one gets initials.

Before the county posts the Nov. 3 page, the tracker fills the race list from the county's zero report
(`fixtures/alameda_zero_report.html`, all votes 0) so every race and candidate is on the map; the page says so in a
banner, and real results replace it as soon as the county's page shows the Nov. 3 election.

Only Berkeley has city-level results (`CONFIG.localCities` in `web/src/config.ts`): other cities are faint outlines with
no tooltips, cards or panel. Within Berkeley, only council districts with a race on the ballot (from the data: 1, 4, 7, 8)
can be selected; clicking one zooms to it, highlights its card and jumps to its race. Scroll speed is set in
`web/src/map/MapView.tsx` (`setWheelZoomRate`).

The URL hash follows the view (`#city=Berkeley`, `#congress=12`, `#county`, `#state`).

Boundaries live in `site/geo/` and come from official sources (`python3 tools/build_geo.py` rebuilds them; Berkeley's council districts come from the county's City_Council_Districts layer):
Census TIGERweb for California, and Alameda County's open-data layers for the county, the four congressional
districts and the city boundaries. The basemap is OpenFreeMap's vector style, stripped to streets, water and town names on a transparent background (`web/src/map/basemap.ts`);
if the style cannot load, the map is plain graph paper with the boundaries. MapLibre GL 4.7.1 and React 18.3.1 are
bundled into `site/app/`; only the Newsreader font loads from Google Fonts.

Look and feel follows the Daily Cal's rent-o-meter map (data.dailycal.org/2026-10-13-rent-o-meter): a pale blue
graph-paper map with only streets and water, the area in view raised as paper with a hard navy shadow (Berkeley's
council districts with a race are raised white), a white top bar with a segmented level toggle, and white cards with a
2px navy border and offset shadow. Type is Newsreader (a free stand-in for the Daily Cal's licensed Tiempos/Plantin).
Two-way bars use dark and light blue, so no party colors are implied; close races get red.

## Measure RTM across all five counties

RTM (the regional transit sales tax) is decided by the combined vote in Alameda, Contra Costa, San Francisco,
San Mateo and Santa Clara counties. `rtm.py` adds them up each poll; the page shows the five-county total plus a
row per county, and leaves out any county it can't read yet (the total says "x of 5 counties").

| County | Source | Before election night |
|---|---|---|
| Alameda | the county results page the tracker already reads | nothing to do |
| San Mateo | the "Results on CSV" export linked from smcacre.gov/node/3146 | nothing to do (zero report is up) |
| Contra Costa | Clarity ENR JSON | set its Nov. 3 Clarity address in `rtm_sources.json` |
| Santa Clara | Clarity ENR JSON | set its Nov. 3 Clarity address in `rtm_sources.json` |
| San Francisco | sfelections.org results page | it refuses automated requests (403), so type its numbers into `rtm_manual.json` |

On election night: open each county's results link, copy the Clarity address up to the election number (for
example `https://results.enr.clarityelections.com/CA/Contra_Costa/126374`) into `rtm_sources.json`, and restart
the tracker. For San Francisco, copy `rtm_manual.example.json` to `rtm_manual.json` and update the Yes/No numbers
from sfelections.org after each of its releases; the tracker re-reads the file every poll. Hand-entered numbers are
marked "typed in" on the page. Any county can be filled by hand the same way if its source breaks.

The mock server serves all four outside sources (`python3 tracker.py --mock ...`), and
`curl 'localhost:8765/__mock/fault?mode=sf403'` makes its San Francisco page refuse requests like the real one.

## Run it

```sh
# Live (needs nothing but Python 3.9+; no dependencies)
python3 tracker.py --serve 8077            # page at http://127.0.0.1:8077/

# Rehearsal: simulated election night, 30 sim-minutes per real second, from 8:00 p.m.
python3 tracker.py --mock --start 0 --speed 30 --interval 5 --serve 8077

# Just the mock server, to point other tools at
python3 mock_server.py --speed 30
curl 'localhost:8765/__mock/clock?set=240'        # jump to 12:00 a.m.
curl 'localhost:8765/__mock/clock?speed=0'        # freeze the clock
curl 'localhost:8765/__mock/fault?mode=500'       # make the data endpoints fail (none|500|garbage)

python3 -m unittest discover -s tests     # data pipeline and mock
(cd web && npm test)                        # the React page's logic: zoom levels, cards, layout
node tests/zoom_levels.test.js              # the classic page (site/classic.html)
node tests/bubbles.test.js                  # the classic page's cards
```

Outputs, in `site/data/`: `results.json` (latest snapshot), `history.json` (one point per change, drives
the line chart), `races.csv` (every Berkeley/county race, flat).

## What to know before election night

* **Today the live sources are not showing real results.** The SoS feed serves test data (100% reporting,
  Prop 40 at 82.6% yes, stamped Oct 26) and Alameda election ID 262 is a placeholder showing the August
  CD-14 special. The tracker detects both and shows a red banner on the page. If the county publishes the
  Nov. 3 results under a different election ID, pass `--election-id`.
* **Alameda ID 260** is an unlisted zero-report rehearsal page with all 148 Nov. 3 contests; it is the
  structure the mock is built from (`fixtures/alameda_zero_report.html`).
* **The mock is synthetic.** It follows the documented feed shapes (SoS v20 guide, observed JSON/CSV
  responses, Alameda page markup) with a made-up turnout curve: a big mail-ballot drop at 8 p.m., batches
  every 15 minutes overnight, every 6 hours afterward, counts that never decrease, and late ballots that
  lean toward Yes on Prop 40. The page shows a yellow "test mode" banner when it is reading the mock.
* **Not modeled:** the SoS `/returns/query` endpoint (needs the contest-ID appendix), candidate contests
  on the SoS feed, ranked-choice tabulation pages, and corrections that lower a count.
* "Leading" on the page is not a race call. Race calls come from AP or the newsroom's own decision.
* Set `CONFIG.masthead` in `web/src/config.ts` to change the title in the top bar, then `npm run build`.
* City-level Prop 40 votes are not published by either source, so city and district views show the county and
  statewide totals for it.
* Restart `tracker.py` after updating the code: the page expects the newer `results.json` (cities, districts,
  governor).

## Files

```
tracker.py        poller + snapshot builder (+ optional static server)
alameda_parse.py  parser for the county results page
mock_server.py    simulated SoS feed and Alameda page, with clock and fault controls
web/              the page's source (React + TypeScript); `npm run build` writes site/index.html and site/app/
site/index.html   the built page: map + results (reads data/results.json every 15 s)
site/classic.html the previous single-file page, kept as a fallback
site/geo/         map boundaries (state, county, congress, city)
tools/build_geo.py  rebuilds site/geo from the official sources
tools/prepare_headshots.py  resizes the headshot folder into site/img/headshots (needs Pillow)
rtm.py            Measure RTM: reads the four other counties and adds up the five-county total
rtm_sources.json  where each county's RTM results come from (set Clarity addresses on election night)
rtm_manual.example.json  template for hand-entered numbers (San Francisco)
fixtures/         county page structure and SoS measure list the mock is built from
tests/            parser, mock-consistency and failure-handling tests
```

## Cloud Run

Deployed as the `election-tracker` service in project `ac-transit-visualizer`, region `us-west1`. It's public, with at most
one instance (so there's only ever one poller), and it scales to zero when nobody is viewing the page.
CPU stays on while an instance is running (`--no-cpu-throttling`), so the poller keeps going between page loads;
redeploys keep this setting.
`Dockerfile` builds the React page and runs `tracker.py --serve $PORT --host 0.0.0.0`.

```sh
# redeploy after code changes
gcloud run deploy election-tracker --source . --project ac-transit-visualizer --region us-west1

# election night: RTM settings live in a bucket mounted at /config and are re-read every poll (no redeploy)
gcloud storage cp rtm_sources.json gs://ac-transit-visualizer-election-config/   # Clarity addresses
gcloud storage cp rtm_manual.json  gs://ac-transit-visualizer-election-config/   # SF numbers typed in

gcloud run services logs read election-tracker --project ac-transit-visualizer --region us-west1 --limit 20
```

Each container keeps its files on its own temporary disk. After a scale to zero or a redeploy, the Prop 40 history
chart starts over, and the page shows no numbers until the first poll finishes (about 15 seconds).
