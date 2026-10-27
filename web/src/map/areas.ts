// Boundary layers on the MapLibre map. Everything is GPU-drawn, so zooming never redraws shapes or flickers.
//
// Transitions between levels:
//   * finer boundaries fade in with zoom (opacity interpolated on zoom, so they come and go continuously);
//   * the area in view is "raised paper" with a hard navy shadow, drawn twice (slots a and b): a new area fades in on
//     one slot while the old one fades out on the other, so switching city -> district -> county -> state cross-fades.
import type { ExpressionSpecification, GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { CONFIG } from "../config";
import type { Area, Geo, Level } from "../types";

const INK = "#20343f", LINK = "#176994";
const EMPTY = { type: "FeatureCollection" as const, features: [] as Area[] };
export const HIT_LAYERS = ["hit-ward", "hit-city", "hit-congress", "hit-county"];
export const HIT_SOURCE: Record<string, "ward" | Level> = { "hit-ward": "ward", "hit-city": "city", "hit-congress": "congress", "hit-county": "county" };

// zoom may only appear at the top of an expression, so per-feature differences go in the output value
const fadeIn = (from: number, to: number, value: number | ExpressionSpecification): ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], from, 0, to, value];
const hoverW = (w: number): ExpressionSpecification => ["case", ["boolean", ["feature-state", "hover"], false], w + 1.4, w];
const isOn = ["boolean", ["feature-state", "elected"], false] as ExpressionSpecification;
const isActive = ["boolean", ["feature-state", "active"], false] as ExpressionSpecification;

export function addAreas(map: MlMap, geo: Geo, beforeId?: string) {
  const fade = { duration: CONFIG.transitionMs, delay: 0 };
  const src = (id: string, data: unknown) => map.addSource(id, { type: "geojson", data: data as any, promoteId: "id" });
  src("state", geo.state); src("county", geo.county); src("congress", geo.congress); src("city", geo.city); src("ward", geo.ward);
  src("cityctx", { ...geo.cityAll, features: geo.cityAll.features.filter(f => !CONFIG.localCities.includes(f.properties.name)) });
  src("active-a", EMPTY); src("active-b", EMPTY);

  // raised paper: under the streets
  for (const s of ["a", "b"]) {
    map.addLayer({ id: `active-shadow-${s}`, type: "fill", source: `active-${s}`, paint: { "fill-color": INK, "fill-translate": [4, 5], "fill-opacity": 0, "fill-opacity-transition": fade, "fill-antialias": false } as any }, beforeId);
    map.addLayer({ id: `active-fill-${s}`, type: "fill", source: `active-${s}`, paint: { "fill-color": "#eef4fb", "fill-opacity": 0, "fill-opacity-transition": fade } as any }, beforeId);
  }
  // Berkeley's council districts with a race: raised white paper; the selected one in blue
  map.addLayer({ id: "ward-shadow", type: "fill", source: "ward", minzoom: 10,
    paint: { "fill-color": INK, "fill-translate": [3, 4], "fill-opacity": fadeIn(10.3, 10.9, ["case", isOn, 1, 0]), "fill-antialias": false } }, beforeId);
  map.addLayer({ id: "ward-fill", type: "fill", source: "ward", minzoom: 10,
    paint: { "fill-color": ["case", isActive, LINK, ["boolean", ["feature-state", "hover"], false], "#f6f9fd", "#ffffff"], "fill-opacity": fadeIn(10.3, 10.9, ["case", isOn, 0.95, 0]) } }, beforeId);

  // outlines: over the streets
  const line = (id: string, source: string, paint: Record<string, unknown>, minzoom = 0) => map.addLayer({ id, type: "line", source, minzoom, layout: { "line-join": "round" }, paint: paint as any });
  line("state-line", "state", { "line-color": INK, "line-width": 1.6, "line-opacity": 0.7 });
  line("county-line", "county", { "line-color": INK, "line-width": hoverW(1.6), "line-opacity": fadeIn(4.4, 5.2, 0.8) }, 4.4);
  line("congress-line", "congress", { "line-color": INK, "line-width": hoverW(1.2), "line-dasharray": [4, 3], "line-opacity": fadeIn(6.4, 7.2, 0.6) }, 6.4);
  line("cityctx-line", "cityctx", { "line-color": INK, "line-width": 0.9, "line-dasharray": [1, 3], "line-opacity": fadeIn(8.4, 9.2, 0.3) }, 8.4);
  line("city-line", "city", { "line-color": INK, "line-width": hoverW(1.3), "line-opacity": fadeIn(8.4, 9.2, 0.85) }, 8.4);
  line("ward-line", "ward", { "line-color": INK, "line-width": ["case", isOn, hoverW(1.6), 1] as any, "line-opacity": fadeIn(10.3, 10.9, ["case", isOn, 1, 0.35]) }, 10);
  for (const s of ["a", "b"]) line(`active-line-${s}`, `active-${s}`, { "line-color": INK, "line-width": 2, "line-opacity": 0, "line-opacity-transition": fade });

  // invisible fills that take hover and clicks (finest first in HIT_LAYERS)
  const hit = (id: string, source: string, minzoom: number) => map.addLayer({ id, type: "fill", source, minzoom, paint: { "fill-color": "#000", "fill-opacity": 0.001 } });
  hit("hit-county", "county", 4.4); hit("hit-congress", "congress", 6.4); hit("hit-city", "city", 8.4); hit("hit-ward", "ward", 10.3);
}

/** Cross-fade the raised "area in view" to a new shape. */
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
    this.set(next, f ? 1 : 0);
    this.set(old, 0);
  }
  private set(s: string, on: number) {
    this.map.setPaintProperty(`active-shadow-${s}`, "fill-opacity", on);
    this.map.setPaintProperty(`active-fill-${s}`, "fill-opacity", on * 0.9);
    this.map.setPaintProperty(`active-line-${s}`, "line-opacity", on);
  }
}

/** feature-state flags: which council districts have a race (raised only while Berkeley is in view), which one is selected. */
export function syncWards(map: MlMap, geo: Geo, elected: Set<string>, active: string | null, berkeleyInView: boolean) {
  for (const f of geo.ward.features) {
    const id = String(f.properties.id);
    map.setFeatureState({ source: "ward", id }, { elected: berkeleyInView && elected.has(id), active: berkeleyInView && active === id });
  }
}
