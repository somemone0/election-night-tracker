// Which level and area the map is showing, from its zoom and centre. Pure functions.
import { CONFIG, HOME_COUNTY, LEVELS } from "../config";
import type { Geo, Level, View } from "../types";
import { anchor, featureAt, featureById } from "./geo";

/** Zoom normalised to a ~1000x740 visible map, so a small window and a big one switch levels at the same view. */
export const effectiveZoom = (zoom: number, visibleW: number, visibleH: number) =>
  zoom + Math.log2(Math.sqrt(Math.max(1, visibleW) * Math.max(1, visibleH)) / 860);

export const bandLevel = (z: number): Level =>
  z > CONFIG.bands.city ? "city" : z > CONFIG.bands.county ? "county" : "state";

/** The area under the point; over water or a gap between shapes, the nearest one whose bounding box covers it. */
function areaNear(geo: Geo, level: Exclude<Level, "state">, c: { lng: number; lat: number }) {
  const hit = featureAt(geo, level, c.lng, c.lat);
  if (hit) return hit;
  const near = geo[level].features.filter(f => { const [w, s, e, n] = f.properties.bbox; return c.lng >= w && c.lng <= e && c.lat >= s && c.lat <= n; });
  const d = (f: (typeof near)[number]) => { const [x, y] = anchor(f); return (x - c.lng) ** 2 + (y - c.lat) ** 2; };
  return near.sort((a, b) => d(a) - d(b))[0] ?? null;
}

/** Finest area at the centre that the zoom band allows. */
export function viewFromBand(geo: Geo, c: { lng: number; lat: number }, z: number): View {
  for (let i = LEVELS.indexOf(bandLevel(z)); i < LEVELS.length; i++) {
    const level = LEVELS[i];
    if (level === "state") break;
    const f = areaNear(geo, level, c);
    if (f) return { level, id: String(f.properties.id) };
  }
  return { level: "state", id: "CA" };
}

export const BAND_SLACK = 0.75;   // zoom change (in levels) that counts as "zooming" rather than a pan

/**
 * After the map stops moving: the view to switch to, or null to stay. A pan that keeps the centre inside the current
 * area, or a small zoom, keeps the view; crossing a band edge or leaving the area picks a new one.
 */
export function nextView(geo: Geo, current: View, c: { lng: number; lat: number }, z: number, anchorZ: number | null): View | null {
  // the county level frames all five RTM counties at once, so anywhere among them keeps the county that was picked
  const inside = current.level === "state" || (current.level === "county" ? !!areaNear(geo, "county", c) : areaNear(geo, current.level, c)?.properties.id === current.id);
  if (anchorZ != null && Math.abs(z - anchorZ) < BAND_SLACK && inside) return null;
  const v = viewFromBand(geo, c, z);
  return v.level === current.level && v.id === current.id ? null : v;
}

export function normalizeView(geo: Geo, level: Level, id: string): View | null {
  if (level === "county" || level === "congress") return { level: "county", id: level === "county" && featureById(geo, "county", id) ? String(id) : HOME_COUNTY };
  if (level === "state") return { level, id: "CA" };
  return featureById(geo, level, id) ? { level, id: String(id) } : null;
}

/** "#city=Berkeley", "#county=rtm", "#state" (old "#congress=12" links open the county level) */
export const viewToHash = (v: View) => "#" + v.level + (v.level === "state" ? "" : "=" + encodeURIComponent(v.id));
export function viewFromHash(geo: Geo, hash: string): View | null {
  const m = hash.match(/^#(city|congress|county|state)(?:=(.+))?$/);
  return m ? normalizeView(geo, m[1] as Level, decodeURIComponent(m[2] || "")) : null;
}

/** The congressional district a city sits in. */
export function districtOf(geo: Geo, city: string) {
  const f = featureById(geo, "city", city);
  if (!f) return null;
  const [x, y] = anchor(f);
  return featureAt(geo, "congress", x, y)?.properties.id ?? null;
}
