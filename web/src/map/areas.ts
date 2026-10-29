// Boundary layers on the MapLibre map. Everything is GPU-drawn, so zooming never redraws shapes or flickers.
//
// Look: white on black, like a chalkboard. California, Measure RTM's five counties and CA-12 are white outlines; Berkeley is the only place
// with streets, and its council districts are the colored, grainy cutouts from the Daily Cal's district graphics.
// A "board" layer covers every street outside Berkeley's city limits.
//
// Transitions between levels:
//   * finer boundaries fade in with zoom (opacity interpolated on zoom, so they come and go continuously);
//   * the area in view gets a faint white wash and a bolder outline, drawn twice (slots a and b): a new area fades in
//     on one slot while the old one fades out on the other, so switching city -> Bay Area -> state cross-fades.
import type { ExpressionSpecification, GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { BOARD, CHALK, CONFIG, DISTRICT_COLORS } from "../config";
import type { Area, Geo, Level } from "../types";

const EMPTY = { type: "FeatureCollection" as const, features: [] as Area[] };
// CA-12 is drawn but not pickable: it shares the Bay Area level with the RTM counties
export const HIT_LAYERS = ["hit-ward", "hit-city", "hit-county"];
export const HIT_SOURCE: Record<string, "ward" | Level> = { "hit-ward": "ward", "hit-city": "city", "hit-county": "county" };

// zoom may only appear at the top of an expression, so per-feature differences go in the output value
const fadeIn = (from: number, to: number, value: number | ExpressionSpecification): ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], from, 0, to, value];
const hoverW = (w: number): ExpressionSpecification => ["case", ["boolean", ["feature-state", "hover"], false], w + 1, w];
const isOn = ["boolean", ["feature-state", "elected"], false] as ExpressionSpecification;   // has a race and Berkeley is in view (selectable)
const hasRace = ["boolean", ["feature-state", "race"], false] as ExpressionSpecification;   // has a race on the ballot this year
const isActive = ["boolean", ["feature-state", "active"], false] as ExpressionSpecification;
const isHover = ["boolean", ["feature-state", "hover"], false] as ExpressionSpecification;
const byDistrict = (key: "fill" | "edge"): ExpressionSpecification =>
  ["match", ["get", "id"], ...Object.entries(DISTRICT_COLORS).flatMap(([id, c]) => [id, c[key]]), CHALK] as unknown as ExpressionSpecification;

/** The cutouts' paper grain: sparse dark specks on a transparent tile, laid over the district colors. */
function grainImage(size = 96) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = "rgba(0,0,0,0.22)";
  for (let i = 0; i < 260; i++) g.fillRect(rnd() * size, rnd() * size, 0.5 + rnd() * 0.6, 0.4 + rnd() * 0.6);
  g.fillStyle = "rgba(255,255,255,0.16)";
  for (let i = 0; i < 120; i++) g.fillRect(rnd() * size, rnd() * size, 0.6, 0.6);
  return g.getImageData(0, 0, size, size);
}

/** The whole world with Berkeley cut out of it (holes wound against the outer ring, as MapLibre expects). */
function outsideOf(cities: Area[]) {
  const signed = (ring: number[][]) => ring.reduce((a, p, i) => { const q = ring[(i + 1) % ring.length]; return a + (q[0] - p[0]) * (q[1] + p[1]); }, 0);
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  const holes = cities.flatMap(f => (f.geometry.type === "MultiPolygon" ? (f.geometry.coordinates as number[][][][]).map(p => p[0]) : [f.geometry.coordinates[0]]) as number[][][])
    .map(r => (Math.sign(signed(r)) === Math.sign(signed(world)) ? [...r].reverse() : r));
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [world, ...holes] } };
}

export function addAreas(map: MlMap, geo: Geo, beforeId?: string) {
  const fade = { duration: CONFIG.transitionMs, delay: 0 };
  const src = (id: string, data: unknown) => map.addSource(id, { type: "geojson", data: data as any, promoteId: "id" });
  src("state", geo.state); src("county", geo.county); src("congress", geo.congress); src("city", geo.city); src("ward", geo.ward);
  src("active-a", EMPTY); src("active-b", EMPTY);
  map.addSource("outside", { type: "geojson", data: outsideOf(geo.city.features) as any });
  if (!map.hasImage("grain")) map.addImage("grain", grainImage(), { pixelRatio: 2 });

  // Berkeley's council districts with a race, in their colors (under the streets); districts without one are left clear
  map.addLayer({ id: "ward-fill", type: "fill", source: "ward", minzoom: 9,
    paint: { "fill-color": byDistrict("fill"), "fill-opacity": fadeIn(9.4, 10.4, ["case", ["!", hasRace], 0, isActive, 1, isHover, ["case", isOn, 1, 0.92], 0.92]) } }, beforeId);
  map.addLayer({ id: "ward-grain", type: "fill", source: "ward", minzoom: 9,
    paint: { "fill-pattern": "grain", "fill-opacity": fadeIn(9.4, 10.4, ["case", hasRace, 1, 0]) } }, beforeId);

  // the board: hides every street outside Berkeley
  map.addLayer({ id: "board", type: "fill", source: "outside", paint: { "fill-color": BOARD, "fill-antialias": false } });

  // faint white washes: each county and the state, the area in view a little more
  map.addLayer({ id: "state-wash", type: "fill", source: "state", paint: { "fill-color": CHALK, "fill-opacity": 0.025 } });
  map.addLayer({ id: "county-wash", type: "fill", source: "county", paint: { "fill-color": CHALK, "fill-opacity": ["case", isHover, 0.07, 0.035] } });
  for (const s of ["a", "b"])
    map.addLayer({ id: `active-fill-${s}`, type: "fill", source: `active-${s}`, paint: { "fill-color": CHALK, "fill-opacity": 0, "fill-opacity-transition": fade } as any });

  // white outlines
  const line = (id: string, source: string, paint: Record<string, unknown>, minzoom = 0) =>
    map.addLayer({ id, type: "line", source, minzoom, layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": CHALK, ...paint } as any });
  line("state-line", "state", { "line-width": 1.6, "line-opacity": 0.75 });
  line("county-line", "county", { "line-width": hoverW(1.2), "line-opacity": fadeIn(4.4, 5.6, 0.6) }, 4.4);
  line("congress-line", "congress", { "line-width": hoverW(1.2), "line-dasharray": [3, 2.5], "line-opacity": fadeIn(6.4, 7.4, 0.75) }, 6.4);
  line("city-line", "city", { "line-width": hoverW(1.4), "line-opacity": fadeIn(7.4, 8.6, 0.85) }, 7.4);
  line("ward-line", "ward", { "line-color": ["case", hasRace, byDistrict("edge"), CHALK] as any, "line-width": ["case", isOn, hoverW(1.2), 0.8] as any,
    "line-opacity": fadeIn(9.4, 10.4, ["case", hasRace, 1, 0.35]) }, 9);
  line("ward-active-line", "ward", { "line-width": 2.4, "line-opacity": fadeIn(9.4, 10.4, ["case", isActive, 1, 0]) }, 9);
  for (const s of ["a", "b"]) line(`active-line-${s}`, `active-${s}`, { "line-width": 2.2, "line-opacity": 0, "line-opacity-transition": fade });

  // invisible fills that take hover and clicks (finest first in HIT_LAYERS)
  const hit = (id: string, source: string, minzoom: number) => map.addLayer({ id, type: "fill", source, minzoom, paint: { "fill-color": "#000", "fill-opacity": 0.001 } });
  hit("hit-county", "county", 4.4); hit("hit-city", "city", 7.4); hit("hit-ward", "ward", 10.3);
}

/** Cross-fade the highlighted "area in view" to a new shape. Berkeley gets no wash, so its districts keep their color. */
export class ActiveArea {
  private slot: "a" | "b" = "a";
  private key: string | null = null;
  constructor(private map: MlMap) {}
  show(f: Area | null) {
    const key = f ? `${f.properties.level}:${f.properties.id}` : null;
    if (key === this.key) return;
    this.key = key;
    const old = this.slot, next = old === "a" ? "b" : "a";
    this.slot = next;
    (this.map.getSource(`active-${next}`) as GeoJSONSource).setData((f ? { type: "FeatureCollection", features: [f] } : EMPTY) as any);
    this.set(next, f ? 1 : 0, f?.properties.level === "city" ? 0 : 0.05);
    this.set(old, 0, 0);
  }
  private set(s: string, line: number, wash: number) {
    this.map.setPaintProperty(`active-fill-${s}`, "fill-opacity", wash);
    this.map.setPaintProperty(`active-line-${s}`, "line-opacity", line);
  }
}

/** feature-state flags: which council districts have a race (colored), which can be picked (Berkeley in view), which one is selected. */
export function syncWards(map: MlMap, geo: Geo, elected: Set<string>, active: string | null, berkeleyInView: boolean) {
  for (const f of geo.ward.features) {
    const id = String(f.properties.id);
    map.setFeatureState({ source: "ward", id }, { race: elected.has(id), elected: berkeleyInView && elected.has(id), active: berkeleyInView && active === id });
  }
}
