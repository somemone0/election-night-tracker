// Point-in-polygon lookups on the boundary files. Pure functions, no map needed (the tests use them directly).
import { CONFIG } from "../config";
import type { Area, AreaCollection, Geo } from "../types";

type Ring = [number, number][];
const polysOf = (g: Area["geometry"]): Ring[][] => (g.type === "MultiPolygon" ? g.coordinates : [g.coordinates]);

function inRing(x: number, y: number, ring: Ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function contains(f: Area, lng: number, lat: number) {
  const [w, s, e, n] = f.properties.bbox;
  if (lng < w || lng > e || lat < s || lat > n) return false;
  return polysOf(f.geometry).some(p => inRing(lng, lat, p[0]) && !p.slice(1).some(h => inRing(lng, lat, h)));
}

type Layer = keyof Geo;
export const featureAt = (geo: Geo, level: Layer, lng: number, lat: number) =>
  geo[level]?.features.find(f => contains(f, lng, lat)) ?? null;
export const featureById = (geo: Geo, level: Layer, id: string | number) =>
  geo[level]?.features.find(f => String(f.properties.id) === String(id)) ?? null;
export const nameOf = (geo: Geo, level: Layer, id: string) => featureById(geo, level, id)?.properties.name ?? id;

const anchors = new WeakMap<Area, [number, number]>();
/** A point inside the shape, [lng, lat]: the bbox centre if it is inside, else the mean of the biggest ring. Cached. */
export function anchor(f: Area): [number, number] {
  const hit = anchors.get(f);
  if (hit) return hit;
  const [w, s, e, n] = f.properties.bbox, cx = (w + e) / 2, cy = (s + n) / 2;
  let out: [number, number];
  if (contains(f, cx, cy)) out = [cx, cy];
  else {
    const ring = polysOf(f.geometry).map(p => p[0]).sort((a, b) => b.length - a.length)[0];
    out = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
  }
  anchors.set(f, out);
  return out;
}

/** Raw boundary files -> Geo, with city split into the selectable local cities and every outline for context. */
export function prepareGeo(raw: Record<"state" | "county" | "congress" | "city" | "ward", AreaCollection>): Geo {
  const all = raw.city ?? { type: "FeatureCollection", features: [] };
  return {
    ...raw,
    cityAll: all,
    city: { ...all, features: all.features.filter(f => CONFIG.localCities.includes(f.properties.name)) },
  };
}

/** city name -> congressional district it mostly sits in (by its anchor point) */
export function cityDistricts(geo: Geo) {
  const out: Record<string, string> = {};
  for (const c of geo.cityAll.features) {
    const [x, y] = anchor(c), d = featureAt(geo, "congress", x, y);
    if (d) out[c.properties.name] = String(d.properties.id);
  }
  return out;
}
