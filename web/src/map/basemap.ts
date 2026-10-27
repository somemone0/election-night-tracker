// The basemap: OpenFreeMap's "positron" style stripped to streets, water and town names on a transparent background,
// so the CSS graph-paper grid shows through (the look of the Daily Cal's rent-o-meter map).
import type { StyleSpecification } from "maplibre-gl";
import { CONFIG } from "../config";

const KEEP = /^(water|waterway|highway_(minor|major_inner|major_subtle|motorway_inner|motorway_subtle|motorway_bridge_inner)|tunnel_motorway_inner|label_(city|town|city_capital))$/;

export function rentStyle(st: StyleSpecification): StyleSpecification {
  st.layers = st.layers.filter(l => l.type === "background" || KEEP.test(l.id));
  for (const l of st.layers as any[]) {
    const p = (l.paint = l.paint || {});
    if (l.type === "background") p["background-opacity"] = 0;
    else if (l.id === "water") { p["fill-color"] = "#c4d6ee"; p["fill-opacity"] = 0.9; }
    else if (l.id === "waterway") p["line-color"] = "#c4d6ee";
    else if (l.type === "line") p["line-color"] = /motorway/.test(l.id) ? "#a9bfdc" : "#b6c9e3";
    else if (l.type === "symbol") { p["text-color"] = "#20343f"; p["text-opacity"] = 0.55; p["text-halo-color"] = "#d9e5f5"; p["text-halo-width"] = 1.5; }
  }
  return st;
}

export const BLANK_STYLE: StyleSpecification = {
  version: 8, sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#000", "background-opacity": 0 } }],
};

/** The restyled vector basemap, or a blank one (graph paper + boundaries) if it cannot load within a few seconds. */
export async function loadStyle(): Promise<{ style: StyleSpecification; vector: boolean }> {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(CONFIG.styleUrl, { signal: ctl.signal });
    if (!r.ok) throw new Error(`style HTTP ${r.status}`);
    return { style: rentStyle(await r.json()), vector: true };
  } catch (e) {
    console.warn("Vector basemap unavailable; showing boundaries on graph paper only:", (e as Error).message);
    return { style: BLANK_STYLE, vector: false };
  } finally {
    clearTimeout(to);
  }
}

/** First basemap layer our areas should sit under: streets and labels draw on top of the raised paper. */
export const firstStreetLayer = (st: StyleSpecification) => st.layers.find(l => /^(highway|tunnel|label)/.test(l.id))?.id;
