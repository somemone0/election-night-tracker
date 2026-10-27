// Which area the map selects at each zoom, using the real boundary files.
import { describe, expect, it } from "vitest";
import { effectiveZoom, nextView, viewFromBand, viewFromHash, viewToHash } from "../src/lib/levels";
import { loadGeo } from "./helpers";

const geo = loadGeo();
const place: Record<string, [number, number]> = { Berkeley: [37.8715, -122.273], Livermore: [37.68, -121.77], Fremont: [37.55, -121.99] };
const at = (name: string, z: number) => { const [lat, lng] = place[name]; const v = viewFromBand(geo, { lat, lng }, z); return `${v.level}:${v.id}`; };

describe("zoom bands", () => {
  it("zooming in over Berkeley goes state -> county -> congress -> city, in order", () => {
    const seq = [5, 6, 7, 8, 9, 10, 11, 12, 13].map(z => at("Berkeley", z).split(":")[0]);
    expect([...new Set(seq)]).toEqual(["state", "county", "congress", "city"]);
    expect(at("Berkeley", 12)).toBe("city:Berkeley");
    expect(at("Berkeley", 10)).toBe("congress:12");
    expect(at("Berkeley", 8)).toBe("county:alameda");
    expect(at("Berkeley", 6)).toBe("state:CA");
  });
  it("other cities have no city level: you stay on their district", () => {
    expect(at("Livermore", 10)).toBe("congress:14");
    expect(at("Livermore", 12)).toBe("congress:14");
    expect(at("Fremont", 13)).toBe("congress:14");
  });
  it("outside the county falls back to the state", () => {
    expect(viewFromBand(geo, { lat: 37.77, lng: -122.45 }, 10).level).toBe("state");
  });
  it("over the bay next to Berkeley, the nearest area still counts (no jump to the state)", () => {
    expect(viewFromBand(geo, { lng: -122.312, lat: 37.898 }, 10.9)).toEqual({ level: "congress", id: "12" });
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
    expect(nextView(geo, { level: "city", id: "Berkeley" }, berk, 10, 12)).toEqual({ level: "congress", id: "12" });
    expect(nextView(geo, { level: "congress", id: "12" }, berk, 12.2, 10)).toEqual({ level: "city", id: "Berkeley" });
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
  it("panning out of the area changes the view even without zooming", () => {
    expect(nextView(geo, { level: "city", id: "Berkeley" }, { lng: -121.77, lat: 37.68 }, 12, 12)).toEqual({ level: "congress", id: "14" });
  });
});

describe("URL hash", () => {
  it("round-trips", () => {
    for (const v of [{ level: "city", id: "Berkeley" }, { level: "congress", id: "12" }, { level: "county", id: "alameda" }, { level: "state", id: "CA" }] as const)
      expect(viewFromHash(geo, viewToHash(v))).toEqual(v);
  });
  it("ignores unknown areas", () => {
    expect(viewFromHash(geo, "#city=Atlantis")).toBeNull();
    expect(viewFromHash(geo, "#nonsense")).toBeNull();
  });
});
