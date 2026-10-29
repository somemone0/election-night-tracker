// The basemap: OpenFreeMap's "positron" style stripped to its streets, drawn white on a transparent background so the
// chalkboard behind the map shows through. The "board" layer in map/areas.ts hides them outside Berkeley.
import type { StyleSpecification } from "maplibre-gl";
import { CONFIG } from "../config";

const KEEP = /^(highway_(minor|major_inner|major_subtle|motorway_inner|motorway_subtle|motorway_bridge_inner)|tunnel_motorway_inner)$/;

export function boardStyle(st: StyleSpecification): StyleSpecification {
  st.layers = st.layers.filter(l => l.type === "background" || KEEP.test(l.id));
  for (const l of st.layers as any[]) {
    const p = (l.paint = l.paint || {});
    if (l.type === "background") p["background-opacity"] = 0;
    else { p["line-color"] = "#FFFFFF"; p["line-opacity"] = 0.92; }   // white streets, as in the district cutouts
  }
  return st;
}

export const BLANK_STYLE: StyleSpecification = {
  version: 8, sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#000", "background-opacity": 0 } }],
};

/** The restyled vector basemap, or a blank one (board + boundaries, no streets) if it cannot load within a few seconds. */
export async function loadStyle(): Promise<{ style: StyleSpecification; vector: boolean }> {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(CONFIG.styleUrl, { signal: ctl.signal });
    if (!r.ok) throw new Error(`style HTTP ${r.status}`);
    return { style: boardStyle(await r.json()), vector: true };
  } catch (e) {
    console.warn("Vector basemap unavailable; showing boundaries without streets:", (e as Error).message);
    return { style: BLANK_STYLE, vector: false };
  } finally {
    clearTimeout(to);
  }
}

/** First basemap layer the district colors should sit under: streets draw on top of them. */
export const firstStreetLayer = (st: StyleSpecification) => st.layers.find(l => /^(highway|tunnel)/.test(l.id))?.id;
