// Which race cards appear at each view, using the real boundaries and a mock-election snapshot.
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cardSpecs, visibleCards } from "../src/lib/cards";
import { cityDistricts } from "../src/lib/geo";
import { headshotOf, setHeadshots } from "../src/lib/headshots";
import type { Results, View } from "../src/types";
import { loadGeo, mockResults, ROOT, rosterRaces } from "./helpers";

const geo = loadGeo();
const cityCd = cityDistricts(geo);
let D: Results;
beforeAll(() => {
  D = mockResults();
  setHeadshots(JSON.parse(fs.readFileSync(path.join(ROOT, "site/img/headshots/index.json"), "utf8")).slugs);
});
const at = (level: View["level"], id: string, data = D) => visibleCards(cardSpecs(data, geo), { level, id }, cityCd);
const tags = (cs: { tag: string }[]) => cs.map(c => c.tag);

describe("cards per level", () => {
  it("state: Prop 40, governor and RTM", () => {
    const t = tags(at("state", "CA"));
    expect(t).toContain("Prop 40 · Statewide");
    expect(t).toContain("Governor");
    expect(t).toContain("Measure RTM · 5 counties");
    expect(t.some(x => /Prop 40 · Alameda/.test(x))).toBe(false);
  });
  it("county: the four House races, county governor, RTM total and Berkeley's cluster", () => {
    const c = at("county", "alameda");
    expect(c.filter(s => s.scope === "congress")).toHaveLength(4);
    expect(tags(c)).toContain("Governor · Alameda Co.");
    const rtm = c.find(s => s.key === "rtm-county")!;
    expect(rtm.meta).toMatch(/5-county total · 5 of 5 in/);
    expect(rtm.who && rtm.margin > 0).toBeTruthy();
    expect(c.filter(s => s.scope === "cluster").map(s => s.cityName)).toEqual(["Berkeley"]);
  });
  it("congress: only that district's race, plus Berkeley's cluster in CA-12", () => {
    const c = at("congress", "12");
    expect(tags(c)).toContain("U.S. House · CA-12");
    expect(tags(c)).not.toContain("U.S. House · CA-14");
    const cl = c.filter(s => s.scope === "cluster");
    expect(cl.map(s => s.cityName)).toEqual(["Berkeley"]);
    expect(cl[0].races!.length).toBeGreaterThanOrEqual(14);
  });
  it("city: Berkeley's council districts with races, capped citywide cards, RTM", () => {
    const c = at("city", "Berkeley");
    expect(c.filter(s => s.scope === "ward").map(s => s.tag).sort()).toEqual(["Council · D1", "Council · D4", "Council · D7", "Council · D8"]);
    expect(c.filter(s => s.scope === "city").length).toBeLessThanOrEqual(4);
    expect(c.some(s => s.more)).toBe(true);
    expect(c.some(s => s.key === "rtm-berkeley")).toBe(true);
    const d4 = c.find(s => s.tag === "Council · D4")!;
    expect(d4.who && d4.margin > 0 && d4.votes > 0).toBeTruthy();
  });
  it("other cities get no cards", () => {
    expect(at("city", "Oakland")).toHaveLength(0);
  });
});

describe("transitions", () => {
  it("every Berkeley card folds into Berkeley's cluster (so it can fly in and out of it)", () => {
    const keys = new Set(at("congress", "12").map(s => s.key));
    for (const s of at("city", "Berkeley")) {
      expect(s.parent).toBe("cluster-Berkeley");
      expect(keys.has(s.parent!)).toBe(true);
    }
  });
  it("card keys are stable between updates, so cards that stay are not re-created", () => {
    const a = at("city", "Berkeley").map(s => s.key), b = at("city", "Berkeley", mockResults(8795)).map(s => s.key);
    expect(b.filter(k => !k.startsWith("more-")).sort()).toEqual(a.filter(k => !k.startsWith("more-")).sort());
  });
});

describe("before the county posts Nov. 3", () => {
  it("council cards exist from the zero report, with candidates and no leader", () => {
    const data = { ...D, races: rosterRaces() };
    const w = at("city", "Berkeley", data).filter(s => s.scope === "ward");
    expect(w).toHaveLength(4);
    expect(w.every(s => !s.who && (s.people?.length ?? 0) >= 2)).toBe(true);
  });
});

describe("headshots", () => {
  it.each([["Steve Kromer", true], ["Igor A. Tregub", true], ["Majdi 'Gaith' Abuhamdieh", true], ["Shoshana O'Keefe", true], ["Lateefah Simon", false]])("%s", (name, ok) => {
    expect(!!headshotOf(name)).toBe(ok);
  });
});
