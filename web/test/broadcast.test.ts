// The Instagram broadcast's slides, from a mock-election snapshot.
import { beforeAll, describe, expect, it } from "vitest";
import { buildSlides, displayName } from "../src/broadcast/slides";
import type { Results } from "../src/types";
import { mockResults, rosterRaces } from "./helpers";

let D: Results;
beforeAll(() => { D = mockResults(8797); });   // own port: test files run in parallel
const ballot = { "Measure V": { question: "", short: "0.5% sales tax for the general fund" }, "Prop 40": { question: "", short: "5% wealth tax" } };

describe("broadcast slides", () => {
  it("loops council, measures, school board, the Bay Area and the state", () => {
    const s = buildSlides(D, ballot, { slideSeconds: 8, stateProps: ["39", "40"], parties: { "Lateefah Simon": "Dem", "Jamie Joyce": "Rep" } });
    expect(s.map(x => x.key)).toEqual(["council", "measures", "school", "bay", "state"]);
    expect(s.map(x => x.tab)).toEqual(["Council", "Measures", "Schools", "Bay Area", "California"]);
    const council = s[0].blocks;
    expect(council.map(b => (b.kind === "cands" ? b.title : ""))).toEqual(["District 1", "District 4", "District 7", "District 8", "Rent Board"]);
    expect(council[0].kind === "cands" && council[0].ward).toBe("1");
    const rent = council[4];
    expect(rent.kind === "cands" && rent.cut).toBe("Top five win");
    const measures = s[1].blocks;
    expect(measures.find(b => b.kind === "measure" && b.letter === "V")).toMatchObject({ label: "0.5% sales tax for the general fund" });
    expect(measures.find(b => b.kind === "measure" && b.letter === "U")).toMatchObject({ needs: "two-thirds" });
    const state = s[4].blocks;
    expect(state.map(b => b.key)).toEqual(expect.arrayContaining(["gov", "prop-39", "prop-40"]));
    const cd12 = state.find(b => b.kind === "cands" && b.title === "Congress");
    expect(cd12 && cd12.kind === "cands" && cd12.partisan).toBe(true);   // party from broadcast.json
  });
  it("only colors a race by party when every candidate shown has one", () => {
    const s = buildSlides(D, {}, { slideSeconds: 8, stateProps: [], parties: { "Lateefah Simon": "Dem" } });
    const cd12 = s.find(x => x.key === "state")!.blocks.find(b => b.kind === "cands" && b.title === "Congress");
    expect(cd12 && cd12.kind === "cands" && cd12.partisan).toBe(false);
  });
  it("works before any votes are counted", () => {
    const s = buildSlides({ ...D, races: rosterRaces() }, {});
    const d1 = s[0].blocks[0];
    expect(d1.kind === "cands" && !d1.counted && d1.margin === null && d1.cands.every(c => !c.win)).toBe(true);
  });
  it("short display names", () => {
    expect(displayName("Majdi 'Gaith' Abuhamdieh")).toBe("Majdi Abuhamdieh");
    expect(displayName("Igor A. Tregub")).toBe("Igor Tregub");
  });
});
