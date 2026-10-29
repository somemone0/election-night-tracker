// Which race cards appear at each view, using the real boundaries and a mock-election snapshot.
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cardSpecs, stripCards, visibleCards } from "../src/lib/cards";
import { ballotKey } from "../src/hooks/useBallot";
import { headshotOf, setHeadshots } from "../src/lib/headshots";
import type { Results, View } from "../src/types";
import { loadGeo, mockResults, ROOT, rosterRaces } from "./helpers";

const geo = loadGeo();
let D: Results;
beforeAll(() => {
  D = mockResults();
  setHeadshots(JSON.parse(fs.readFileSync(path.join(ROOT, "site/img/headshots/index.json"), "utf8")).slugs);
});
const at = (level: View["level"], id: string, data = D) => visibleCards(cardSpecs(data, geo), { level, id });
const tags = (cs: { tag: string }[]) => cs.map(c => c.tag);

describe("cards per level", () => {
  it("state: Prop 40, governor and RTM", () => {
    const t = tags(at("state", "CA"));
    expect(t).toContain("Prop 40 · Statewide");
    expect(t).toContain("Governor");
    expect(t).toContain("Measure RTM · 5 counties");
    expect(t.some(x => /Prop 40 · Alameda/.test(x))).toBe(false);
  });
  it("Bay Area (county and congress merged): RTM total and county measures, CA-12, Berkeley's cluster", () => {
    const c = at("county", "rtm");
    expect(c.filter(s => s.scope === "congress").map(s => s.tag)).toEqual(["U.S. House · CA-12"]);
    expect(c.filter(s => s.scope === "county").map(s => s.key)).toEqual(["rtm-county"]);   // the mock's only county measure is RTM
    const rtm = c.find(s => s.key === "rtm-county")!;
    expect(rtm.meta).toBe("5-county total");
    expect(rtm.who && rtm.margin > 0).toBeTruthy();
    expect(c.filter(s => s.scope === "cluster").map(s => s.cityName)).toEqual(["Berkeley"]);
    expect(at("congress", "12").map(s => s.key)).toEqual(c.map(s => s.key));   // old #congress links show the same
  });
  it("county measures other than RTM get a card on the Bay Area", () => {
    const extra = { ...D.races.find(r => /^Measure RTM/.test(r.title))!, id: "zz", title: "Measure A - Alameda County Fire Services" };
    const c = at("county", "rtm", { ...D, races: [...D.races, extra] });
    expect(c.find(s => s.key === "zz")?.title).toBe("Measure A");
  });
  it("city: only Berkeley's council districts with races, pinned to their districts", () => {
    const c = at("city", "Berkeley");
    expect(c.map(s => s.tag).sort()).toEqual(["Council · D1", "Council · D4", "Council · D7", "Council · D8"]);
    expect(c.every(s => s.pin)).toBe(true);
    const d4 = c.find(s => s.tag === "Council · D4")!;
    expect(d4.who && d4.margin > 0 && d4.votes > 0).toBeTruthy();
  });
  it("other cities get no cards", () => {
    expect(at("city", "Oakland")).toHaveLength(0);
  });
});

describe("Berkeley's strip", () => {
  it("has every race on a Berkeley ballot, in order, each selectable", () => {
    const st = stripCards(cardSpecs(D, geo), D);
    const t = tags(st);
    expect(t.slice(0, 4)).toEqual(["Council · D1", "Council · D4", "Council · D7", "Council · D8"]);
    const berk = D.races.filter(r => r.city === "Berkeley").length;
    expect(st.filter(s => s.cityName === "Berkeley" && s.key !== "rtm-berkeley")).toHaveLength(berk);
    expect(t.indexOf("Measure RTM")).toBeGreaterThan(t.indexOf("Measure V"));
    expect(t.indexOf("U.S. House · CA-12")).toBeGreaterThan(t.indexOf("Measure RTM"));
    expect(t).toContain("Prop 40 · Statewide");
    expect(t).toContain("Prop 41 · Statewide");
    expect(t.filter(x => x === "Prop 40 · Statewide")).toHaveLength(1);
    expect(st.every(s => s.focus)).toBe(true);
    expect(new Set(st.map(s => s.key)).size).toBe(st.length);
  });
  it("ballot text keys", () => {
    expect(ballotKey("Bond Measure U - City of Berkeley")).toBe("Measure U");
    expect(ballotKey("Measure RTM - Public Transit Revenue Measure District")).toBe("Measure RTM");
  });
});

describe("transitions", () => {
  it("every Berkeley card folds into Berkeley's cluster (so it can fly in and out of it)", () => {
    const keys = new Set(at("county", "rtm").map(s => s.key));
    for (const s of at("city", "Berkeley")) {
      expect(s.parent).toBe("cluster-Berkeley");
      expect(keys.has(s.parent!)).toBe(true);
    }
  });
  it("card keys are stable between updates, so cards that stay are not re-created", () => {
    const a = at("city", "Berkeley").map(s => s.key), b = at("city", "Berkeley", mockResults(8795)).map(s => s.key);
    expect(b.sort()).toEqual(a.sort());
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
