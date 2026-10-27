import type { Level, View } from "./types";

export const CONFIG = {
  masthead: "election night in berkeley",   // title in the top bar
  results: "data/results.json",
  history: "data/history.json",
  headshots: "img/headshots/index.json",
  geo: { state: "geo/state.json", county: "geo/county.json", congress: "geo/congress.json", city: "geo/city.json", ward: "geo/ward.json" },
  refreshMs: 15000,
  fetchTimeoutMs: 10000,
  staleAfterMs: 5 * 60 * 1000,
  start: { level: "city", id: "Berkeley" } as View,   // what the page opens on
  localCities: ["Berkeley"],                          // only these cities get city-level results, cards and tooltips
  // Zoom bands, in MapLibre zoom adjusted for map size (see effectiveZoom): above 11.5 city, 9.5 district, 7.5 county,
  // otherwise state. Moving between bands changes the level; small zooms inside a band never do (BAND_SLACK).
  bands: { city: 11.5, congress: 9.5, county: 7.5 },
  // Basemap: OpenFreeMap's vector tiles (free, no key), stripped to streets and water in map/basemap.ts.
  // If the style cannot load the map is plain graph paper with the boundaries, which is all the results need.
  styleUrl: "https://tiles.openfreemap.org/styles/positron",
  transitionMs: 320,
};

export const LEVELS: Level[] = ["city", "congress", "county", "state"];
export const RANK: Record<Level, number> = { city: 0, congress: 1, county: 2, state: 3 };   // smaller = finer
export const LEVEL_LABEL: Record<Level, string> = { city: "City", congress: "Congress", county: "County", state: "State" };
export const HOME = CONFIG.start.id;   // the city this page is about; its cluster also shows at county level
