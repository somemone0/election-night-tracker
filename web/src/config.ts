import { S } from "./strings";
import type { Level, View } from "./types";

export const CONFIG = {
  masthead: S.masthead,   // title in the top bar
  results: "data/results.json",
  history: "data/history.json",
  // Set at build time to read results from the Google Sheet instead of the tracker (README, "Hosting on data.dailycal.org"):
  // the Page tab's publish-to-web CSV link, or the sheet's Apps Script /exec URL.
  sheet: (import.meta.env.VITE_SHEET_URL as string | undefined) ?? "",
  headshots: "img/headshots/index.json",
  measures: "measures.json",                          // ballot question text, typed in by the desk (see README)
  geo: { state: "geo/state.json", county: "geo/county.json", congress: "geo/congress.json", city: "geo/city.json", ward: "geo/ward.json" },
  refreshMs: import.meta.env.VITE_SHEET_URL ? 60000 : 15000,   // the tracker writes the sheet once a minute
  fetchTimeoutMs: 10000,
  // A published sheet can lag up to five minutes behind the tracker, so "last updated" waits longer there.
  staleAfterMs: (import.meta.env.VITE_SHEET_URL ? 12 : 5) * 60 * 1000,
  start: { level: "city", id: "Berkeley" } as View,   // what the page opens on
  localCities: ["Berkeley"],                          // only these cities get city-level results, cards and tooltips
  // Zoom bands, in MapLibre zoom adjusted for map size (see effectiveZoom): above 11.5 city, 7.5 Bay Area (the five RTM
  // counties with CA-12 inside them), otherwise state. Moving between bands changes the level; small zooms inside a band
  // never do (BAND_SLACK).
  bands: { city: 11.5, county: 7.5 },
  // Basemap: OpenFreeMap's vector tiles (free, no key), stripped to streets in map/basemap.ts (shown inside Berkeley only).
  // If the style cannot load the map is the bare chalkboard with the boundaries, which is all the results need.
  styleUrl: "https://tiles.openfreemap.org/styles/positron",
  transitionMs: 320,
};

// "congress" is not a level of its own any more: CA-12 is shown on the Bay Area level ("county"). Old #congress links land there.
export const LEVELS: Level[] = ["city", "county", "state"];
export const RANK: Record<Level, number> = { city: 0, congress: 1, county: 2, state: 3 };   // smaller = finer
export const LEVEL_LABEL: Record<Level, string> = S.levels;
export const HOME = CONFIG.start.id;   // the city this page is about; its cluster also shows at county level

// Original district colors from the Daily Cal's Berkeley District Cutouts graphics.
export const DISTRICT_COLORS: Record<string, { fill: string; edge: string }> = {
  "1": { fill: "#AB4B50", edge: "#7D373A" }, "2": { fill: "#3C8284", edge: "#2C5F60" },
  "3": { fill: "#8F5166", edge: "#683B4A" }, "4": { fill: "#B89A41", edge: "#86702F" },
  "5": { fill: "#73577B", edge: "#54405A" }, "6": { fill: "#749254", edge: "#556B3D" },
  "7": { fill: "#487A9B", edge: "#355971" }, "8": { fill: "#B5673C", edge: "#844B2C" },
};
export const INK = "#242A30", PAPER = "#F5F3EE";
export const CHALK = "#FFFFFF", BOARD = "#0D0D0D";   // white on black, like a chalkboard

// The county level is one shape: Measure RTM's five counties merged ("Bay Area", built by tools/build_geo.py).
export const HOME_COUNTY = "rtm";
