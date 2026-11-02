// Race cards (styled after meetvc.cafe's café cards). Each card is a race, anchored to the area it covers: statewide races
// on California, Measure RTM and county measures on the Bay Area shape, CA-12 on its district, city races on the city,
// and Berkeley council races on their council district. Zoomed out, a city's races fold into one stacked "cluster" card.
// In Berkeley, every race on the ballot is also in the scrolling strip along the bottom of the map (stripCards).
// Pure functions: which cards exist (cardSpecs), which show on the map in a view (visibleCards), and the strip.
import { CONFIG, HOME, HOME_COUNTY } from "../config";
import type { Call, Geo, MeasureCount, Race, Results, Row, View } from "../types";
import { anchor, featureById } from "./geo";
import { cleanTitle, isChoice, last, pct, threshold } from "./format";
import { S } from "../strings";

export interface Lead { who: string | null; margin: number; votes: number; sub: string | null }

export interface CardSpec extends Lead {
  key: string;
  scope: "state" | "county" | "congress" | "city" | "ward" | "cluster";
  area: [string, string];
  ll: [number, number];          // [lng, lat]
  title: string; tag: string; meta: string;
  prio: number;                  // lower = placed first
  focus: string | null;          // the race a click selects for the detail panel (see panels/Detail.tsx for the ids)
  go: View;                      // where a click takes the map
  people?: Row[] | null;
  measure?: MeasureCount | null;
  races?: Race[];
  cityName?: string;
  parent?: string;               // the cluster card this card folds into when zooming out (used for the transition)
  more?: boolean; moreCount?: number;
  call?: Call | null;            // the race has been called (calls.py)
  pin?: boolean;                 // sits centered on its point, never moved (council districts)
}

export const WARD_RE = /City Council, District (\d+)/;

export function leadMeasure(m: MeasureCount, rule?: string | null): Lead {
  const out: Lead = { who: null, margin: 0, votes: 0, sub: null };
  if (!(m.yes + m.no)) return out;
  out.votes = Math.abs(m.yes - m.no);
  out.margin = Math.abs(m.yes_pct - m.no_pct);
  out.who = m.leader === "tied" ? S.tied : m.leader === "yes" ? S.yes : S.no;
  const th = threshold(rule);
  if (th > 50) out.sub = S.needs(pct(th, th % 1 ? 1 : 0));
  return out;
}
export function leadRows(rows: Row[], total: number): Lead {
  const out: Lead = { who: null, margin: 0, votes: 0, sub: null };
  if (!rows.length) return out;
  if (rows.length === 1) return { ...out, who: total ? rows[0].name : null, sub: S.unopposed };
  if (!total) return out;
  return { who: rows[0].name, margin: rows[0].pct - rows[1].pct, votes: rows[0].votes - rows[1].votes, sub: null };
}
export const leadRace = (r: Race) => (r.kind === "measure" ? leadMeasure(r, r.rule) : leadRows(r.rows, r.total));
export const shortWho = (n: string | null) => (n ? (isChoice(n) || n === S.yes || n === S.no || n === S.tied ? n : last(n.replace(/\s*\(.*\)\s*$/, ""))) : "");
export const isClose = (s: Lead) => !!s.who && s.who !== S.tied && s.sub !== S.unopposed && s.margin < 3;

export function shortRace(r: Race) {   // a few words for a card title
  if (r.kind === "measure") return r.title.replace(/\s*-\s*.*$/, "");   // "Measure V", "Bond Measure U"
  const t = cleanTitle(r.title) || r.title;
  if (/City Council/i.test(t)) return S.cityCouncil;
  if (/^Mayor/i.test(t)) return S.mayor;
  if (/School|Education/i.test(t)) return S.schoolBoard;
  if (/Rent Stabilization/i.test(t)) return S.rentBoard;
  return t;
}

export const rtmRace = (D: Results | null) => (D?.races || []).find(r => /^Measure RTM\b/.test(r.title)) ?? null;

export function cardSpecs(D: Results | null, geo: Geo | null): CardSpec[] {
  const specs: CardSpec[] = [];
  if (!D || !geo) return specs;
  const ll = (level: keyof Geo, id: string | number): [number, number] | null => {
    const f = featureById(geo, level, id);
    return f ? anchor(f) : null;
  };
  const push = (s: Omit<CardSpec, "ll"> & { ll: [number, number] | null }) => { if (s.ll) specs.push(s as CardSpec); };
  const h = D.headline, g = D.contests?.governor;
  const gov = (c: { candidates: Row[]; total: number; call?: Call }) => ({ people: c.candidates, ...leadRows(c.candidates, c.total), call: c.call });
  const STATE: View = { level: "state", id: "CA" }, COUNTY: View = { level: "county", id: HOME_COUNTY };

  if (h?.state) push({ key: "p40-state", scope: "state", area: ["state", "CA"], ll: ll("state", "CA"), title: S.prop(h.number), tag: S.propTag(h.number), meta: S.statewide, measure: h.state, ...leadMeasure(h.state), call: h.state.call, prio: 1, focus: "p40", go: STATE });
  if (g?.state) push({ key: "gov-state", scope: "state", area: ["state", "CA"], ll: ll("state", "CA"), title: S.governor, tag: S.governor, meta: S.statewide, ...gov(g.state), prio: 2, focus: "gov", go: STATE });

  const rtmA = rtmRace(D);
  if (D.rtm || rtmA) {   // the five-county total when the tracker has it, else Alameda's own count
    const m: MeasureCount = D.rtm ? D.rtm.total : (rtmA as MeasureCount & Race);
    const rule = D.rtm ? D.rtm.rule : rtmA!.rule;
    const meta = D.rtm ? (D.rtm.complete ? S.fiveCountyTotal : S.fiveCountyIn(D.rtm.counties_in)) : S.alamedaCounty;
    const base = { measure: m, ...leadMeasure(m, rule), title: S.measureRtm, focus: D.rtm ? "rtm" : "race-" + rtmA!.id, call: D.rtm?.total.call };
    push({ ...base, key: "rtm-county", scope: "county", area: ["county", HOME_COUNTY], ll: ll("county", HOME_COUNTY), tag: S.rtmTag, meta, prio: 1, go: COUNTY });
    push({ ...base, key: "rtm-berkeley", scope: "city", area: ["city", HOME], ll: ll("city", HOME), tag: S.measureRtm, cityName: HOME, parent: "cluster-" + HOME, meta, prio: 5, go: { level: "city", id: HOME } });
  }

  const byCity: Record<string, Race[]> = {};
  for (const r of D.races || []) {
    const base = { people: r.kind === "measure" ? null : r.rows, measure: r.kind === "measure" ? r : null, ...leadRace(r), call: r.call, focus: "race-" + r.id };
    if (r.group === "county" && r.category === "Measures" && r !== rtmA) {   // county measures, on the Bay Area level with RTM
      push({ ...base, key: r.id, scope: "county", area: ["county", HOME_COUNTY], ll: ll("county", HOME_COUNTY), title: shortRace(r), tag: S.countyTag(shortRace(r)), meta: S.alamedaCounty, prio: 2, go: COUNTY });
    } else if (r.group === "congress" && r.cd != null) {
      push({ ...base, key: r.id, scope: "congress", area: ["congress", String(r.cd)], ll: ll("congress", r.cd), title: S.cdShort(r.cd), tag: S.cdTag(r.cd), meta: S.usHouse, prio: 1, go: COUNTY });
    } else if (r.group === "city" && r.city && CONFIG.localCities.includes(r.city)) {
      (byCity[r.city] ||= []).push(r);
      const w = r.city === "Berkeley" && WARD_RE.exec(r.title);
      const go: View = { level: "city", id: r.city }, parent = "cluster-" + r.city;
      if (w) push({ ...base, key: r.id, scope: "ward", area: ["ward", w[1]], ll: ll("ward", w[1]), title: S.district(w[1]), tag: S.wardTag(w[1]), meta: S.cityCouncil, prio: 1, go, parent, cityName: r.city });
      else push({ ...base, key: r.id, scope: "city", area: ["city", r.city], ll: ll("city", r.city), title: shortRace(r), tag: shortRace(r), cityName: r.city, meta: r.city, prio: 10 + (base.who ? Math.min(base.margin, 90) : 50), go, parent });
    }
  }
  for (const [city, races] of Object.entries(byCity))
    push({ key: "cluster-" + city, scope: "cluster", area: ["city", city], ll: ll("city", city), title: city, tag: city, meta: "", cityName: city, races, prio: city === HOME ? 0.5 : 5, focus: null, go: { level: "city", id: city }, who: null, margin: 0, votes: 0, sub: null });
  return specs;
}

export function visibleCards(all: CardSpec[], view: View): CardSpec[] {
  const L = view.level;
  if (L === "state") return all.filter(s => s.scope === "state" || (s.scope === "county" && s.key === "rtm-county"));
  // the Bay Area: RTM and county measures on the five counties, CA-12 (the only district with a boundary) and Berkeley's cluster
  if (L === "county" || L === "congress") return all.filter(s => s.scope === "county" || s.scope === "congress" || (s.scope === "cluster" && s.cityName === HOME));
  // a city: council districts stay centered on their district; everything else is in the strip along the bottom
  return all.filter(s => s.scope === "ward" && s.cityName === view.id).map(s => ({ ...s, pin: true }));
}

/** Every race on a Berkeley ballot, in ballot-ish order: council, other city offices, city measures, RTM, the House,
 *  county measures, then statewide (Prop 40, governor, the other propositions). */
export function stripCards(all: CardSpec[], D: Results | null): CardSpec[] {
  if (!D) return [];
  const wardN = (s: CardSpec) => Number(s.area[1]);
  const city = all.filter(s => s.cityName === HOME && s.scope !== "cluster" && s.key !== "rtm-berkeley");
  const out = [
    ...city.filter(s => s.scope === "ward").sort((a, b) => wardN(a) - wardN(b)),
    ...city.filter(s => s.scope === "city" && !s.measure),
    ...city.filter(s => s.scope === "city" && s.measure),
    ...all.filter(s => s.key === "rtm-berkeley"),
    ...all.filter(s => s.scope === "congress"),
    ...all.filter(s => s.scope === "county" && s.key !== "rtm-county"),
    ...all.filter(s => s.scope === "state"),
  ];
  const ll = all.find(s => s.scope === "state")?.ll ?? [-119.5, 37.2];
  const props = D.state_measures.filter(m => m.number !== D.headline?.number).sort((a, b) => Number(a.number) - Number(b.number));
  for (const m of props)
    out.push({ key: "prop-" + m.number, scope: "state", area: ["state", "CA"], ll, title: S.prop(m.number), tag: S.propTag(m.number), meta: S.statewide,
      measure: m.state, ...leadMeasure(m.state), call: m.state.call, prio: 3, focus: "prop-" + m.number, go: { level: "state", id: "CA" } });
  return out;
}

/** Council districts with a race on the ballot (only these can be selected on the map). */
export function electedWards(D: Results | null) {
  const out = new Set<string>();
  for (const r of D?.races || []) { const m = r.city === "Berkeley" && WARD_RE.exec(r.title); if (m) out.add(m[1]); }
  return out;
}

/** Changes whenever anything a card shows changes; cheap to compare. */
export const cardSig = (s: CardSpec) =>
  [s.key, s.who, s.margin.toFixed(1), s.votes, s.sub, s.meta, s.races?.length ?? 0, s.measure ? `${s.measure.yes}/${s.measure.no}` : "", (s.people || []).map(p => p.votes).join(","),
    s.call ? s.call.winners.join("+") : "", s.races?.filter(r => r.call).length ?? 0].join("~");
