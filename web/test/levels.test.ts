// Which area the map selects at each zoom, using the real boundary files.
import { describe, expect, it } from "vitest";
import { effectiveZoom, nextView, viewFromBand, viewFromHash, viewToHash } from "../src/lib/levels";
import { loadGeo } from "./helpers";

const geo = loadGeo();
const place: Record<string, [number, number]> = { Berkeley: [37.8715, -122.273], Livermore: [37.68, -121.77], Fremont: [37.55, -121.99] };
const at = (name: string, z: number) => { const [lat, lng] = place[name]; const v = viewFromBand(geo, { lat, lng }, z); return `${v.level}:${v.id}`; };

describe("zoom bands", () => {
  it("zooming in over Berkeley goes state -> Bay Area -> city, in order (no separate congress level)", () => {
    const seq = [5, 6, 7, 8, 9, 10, 11, 12, 13].map(z => at("Berkeley", z).split(":")[0]);
    expect([...new Set(seq)]).toEqual(["state", "county", "city"]);
    expect(at("Berkeley", 12)).toBe("city:Berkeley");
    expect(at("Berkeley", 10)).toBe("county:rtm");
    expect(at("Berkeley", 8)).toBe("county:rtm");
    expect(at("Berkeley", 6)).toBe("state:CA");
  });
  it("only Berkeley has a finer level: elsewhere in Alameda you stay on the county", () => {
    expect(at("Livermore", 10)).toBe("county:rtm");
    expect(at("Livermore", 12)).toBe("county:rtm");
    expect(at("Fremont", 13)).toBe("county:rtm");
  });
  it("all five Measure RTM counties are one shape", () => {
    expect(viewFromBand(geo, { lat: 37.77, lng: -122.45 }, 10)).toEqual({ level: "county", id: "rtm" });   // San Francisco
    expect(viewFromBand(geo, { lat: 37.5, lng: -122.3 }, 9)).toEqual({ level: "county", id: "rtm" });     // San Mateo
  });
  it("outside the five counties falls back to the state", () => {
    expect(viewFromBand(geo, { lat: 38.58, lng: -121.49 }, 10).level).toBe("state");   // Sacramento
  });
  it("over the bay next to Berkeley, the nearest area still counts (no jump to the state)", () => {
    expect(viewFromBand(geo, { lng: -122.312, lat: 37.898 }, 10.9)).toEqual({ level: "county", id: "rtm" });
    expect(viewFromBand(geo, { lng: -122.312, lat: 37.898 }, 8.5).level).toBe("county");
  });
  it("a 1000x740 map is the reference size", () => {
    expect(effectiveZoom(10, 1000, 740)).toBeCloseTo(10, 1);
    expect(effectiveZoom(10, 500, 370)).toBeCloseTo(9, 1);
  });
});

describe("nextView (after the map stops)", () => {
  const berk = { lng: -122.273, lat: 37.8715 };
  it("a pan or small zoom inside the area keeps the view", () => {
    expect(nextView(geo, { level: "city", id: "Berkeley" }, berk, 12.3, 12)).toBeNull();
  });
  it("crossing a band edge changes the view", () => {
    expect(nextView(geo, { level: "city", id: "Berkeley" }, berk, 10, 12)).toEqual({ level: "county", id: "rtm" });
    expect(nextView(geo, { level: "county", id: "rtm" }, berk, 12.2, 10)).toEqual({ level: "city", id: "Berkeley" });
  });
  it("zooming in small steps still changes level once the steps add up", () => {
    // the app keeps anchorZ at the zoom where the view last changed
    let view = { level: "state", id: "CA" } as const as { level: any; id: string }, anchorZ = 6;
    for (let z = 6; z <= 12.5; z += 0.5) {
      const v = nextView(geo, view, berk, z, anchorZ);
      if (v) { view = v; anchorZ = z; }
    }
    expect(view).toEqual({ level: "city", id: "Berkeley" });
  });
  it("at the county level, panning among the five counties keeps the picked county", () => {
    expect(nextView(geo, { level: "county", id: "rtm" }, { lng: -122.35, lat: 37.55 }, 8.5, 8.5)).toBeNull();   // over San Mateo
  });
  it("panning out of the area changes the view even without zooming", () => {
    expect(nextView(geo, { level: "city", id: "Berkeley" }, { lng: -121.77, lat: 37.68 }, 12, 12)).toEqual({ level: "county", id: "rtm" });
  });
});

describe("URL hash", () => {
  it("round-trips", () => {
    for (const v of [{ level: "city", id: "Berkeley" }, { level: "county", id: "rtm" }, { level: "state", id: "CA" }] as const)
      expect(viewFromHash(geo, viewToHash(v))).toEqual(v);
  });
  it("old congress links open the Bay Area level", () => {
    expect(viewFromHash(geo, "#congress=12")).toEqual({ level: "county", id: "rtm" });
  });
  it("ignores unknown areas", () => {
    expect(viewFromHash(geo, "#city=Atlantis")).toBeNull();
    expect(viewFromHash(geo, "#nonsense")).toBeNull();
  });
});
