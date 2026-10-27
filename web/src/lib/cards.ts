// Race cards on the map (styled after meetvc.cafe's café cards). Each card is a race, anchored to the area it covers:
// statewide races on California, county races on Alameda County, House races on their district, city races on the city,
// and Berkeley council races on their council district. Zoomed out, a city's races fold into one stacked "cluster" card.
// Pure functions: which cards exist (cardSpecs) and which show in a view (visibleCards).
import { CONFIG, HOME } from "../config";
import type { Geo, MeasureCount, Race, Results, Row, View } from "../types";
import { anchor, featureById } from "./geo";
import { cleanTitle, isChoice, last, pct, threshold } from "./format";

export interface Lead { who: string | null; margin: number; votes: number; sub: string | null }

export interface CardSpec extends Lead {
  key: string;
  scope: "state" | "county" | "congress" | "city" | "ward" | "cluster";
  area: [string, string];
  ll: [number, number];          // [lng, lat]
  title: string; tag: string; meta: string;
  prio: number;                  // lower = placed first
  focus: string | null;          // id of the results-panel item a click scrolls to
  go: View;                      // where a click takes the map
  people?: Row[] | null;
  measure?: MeasureCount | null;
  races?: Race[];
  cityName?: string;
  parent?: string;               // the cluster card this card folds into when zooming out (used for the transition)
  more?: boolean; moreCount?: number;
}

export const WARD_RE = /City Council, District (\d+)/;

export function leadMeasure(m: MeasureCount, rule?: string | null): Lead {
  const out: Lead = { who: null, margin: 0, votes: 0, sub: null };
  if (!(m.yes + m.no)) return out;
  out.votes = Math.abs(m.yes - m.no);
  out.margin = Math.abs(m.yes_pct - m.no_pct);
  out.who = m.leader === "tied" ? "Tied" : m.leader === "yes" ? "Yes" : "No";
  const th = threshold(rule);
  if (th > 50) out.sub = `Needs ${pct(th, th % 1 ? 1 : 0)}`;
  return out;
}
export function leadRows(rows: Row[], total: number): Lead {
  const out: Lead = { who: null, margin: 0, votes: 0, sub: null };
  if (!rows.length) return out;
  if (rows.length === 1) return { ...out, who: total ? rows[0].name : null, sub: "Unopposed" };
  if (!total) return out;
  return { who: rows[0].name, margin: rows[0].pct - rows[1].pct, votes: rows[0].votes - rows[1].votes, sub: null };
}
export const leadRace = (r: Race) => (r.kind === "measure" ? leadMeasure(r, r.rule) : leadRows(r.rows, r.total));
export const shortWho = (n: string | null) => (n ? (isChoice(n) || n === "Tied" ? n : last(n.replace(/\s*\(.*\)\s*$/, ""))) : "");
export const isClose = (s: Lead) => !!s.who && s.who !== "Tied" && s.sub !== "Unopposed" && s.margin < 3;

export function shortRace(r: Race) {   // a few words for a card title
  if (r.kind === "measure") return r.title.replace(/\s*-\s*.*$/, "");   // "Measure V", "Bond Measure U"
  const t = cleanTitle(r.title) || r.title;
  if (/City Council/i.test(t)) return "City council";
  if (/^Mayor/i.test(t)) return "Mayor";
  if (/School|Education/i.test(t)) return "School board";
  if (/Rent Stabilization/i.test(t)) return "Rent board";
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
  const gov = (c: { candidates: Row[]; total: number }) => ({ people: c.candidates, ...leadRows(c.candidates, c.total) });
  const STATE: View = { level: "state", id: "CA" }, COUNTY: View = { level: "county", id: "alameda" };

  if (h?.state) push({ key: "p40-state", scope: "state", area: ["state", "CA"], ll: ll("state", "CA"), title: "Prop 40", tag: "Prop 40 · Statewide", meta: "Statewide", measure: h.state, ...leadMeasure(h.state), prio: 1, focus: "p40", go: STATE });
  if (g?.state) push({ key: "gov-state", scope: "state", area: ["state", "CA"], ll: ll("state", "CA"), title: "Governor", tag: "Governor", meta: "Statewide", ...gov(g.state), prio: 2, focus: "gov-state", go: STATE });

  const rtmA = rtmRace(D);
  if (D.rtm || rtmA) {   // the five-county total when the tracker has it, else Alameda's own count
    const m: MeasureCount = D.rtm ? D.rtm.total : (rtmA as MeasureCount & Race);
    const rule = D.rtm ? D.rtm.rule : rtmA!.rule;
    const meta = D.rtm ? `5-county total · ${D.rtm.counties_in} of 5 in` : "Alameda County";
    const base = { measure: m, ...leadMeasure(m, rule), title: "Measure RTM", focus: D.rtm ? "rtm" : "race-" + rtmA!.id };
    push({ ...base, key: "rtm-county", scope: "county", area: ["county", "alameda"], ll: ll("county", "alameda"), tag: "Measure RTM · 5 counties", meta, prio: 1, go: COUNTY });
    push({ ...base, key: "rtm-berkeley", scope: "city", area: ["city", HOME], ll: ll("city", HOME), tag: "Measure RTM", cityName: HOME, parent: "cluster-" + HOME, meta, prio: 5, go: { level: "city", id: HOME } });
  }
  if (g?.alameda) push({ key: "gov-alameda", scope: "county", area: ["county", "alameda"], ll: ll("county", "alameda"), title: "Governor", tag: "Governor · Alameda Co.", meta: "Alameda Co.", ...gov(g.alameda), prio: 2, focus: "gov-alameda", go: COUNTY });

  const byCity: Record<string, Race[]> = {};
  for (const r of D.races || []) {
    const base = { people: r.kind === "measure" ? null : r.rows, measure: r.kind === "measure" ? r : null, ...leadRace(r), focus: "race-" + r.id };
    if (r.group === "congress" && r.cd != null) {
      push({ ...base, key: r.id, scope: "congress", area: ["congress", String(r.cd)], ll: ll("congress", r.cd), title: `CA-${r.cd}`, tag: `U.S. House · CA-${r.cd}`, meta: "U.S. House", prio: 1, go: { level: "congress", id: String(r.cd) } });
    } else if (r.group === "city" && r.city && CONFIG.localCities.includes(r.city)) {
      (byCity[r.city] ||= []).push(r);
      const w = r.city === "Berkeley" && WARD_RE.exec(r.title);
      const go: View = { level: "city", id: r.city }, parent = "cluster-" + r.city;
      if (w) push({ ...base, key: r.id, scope: "ward", area: ["ward", w[1]], ll: ll("ward", w[1]), title: `District ${w[1]}`, tag: `Council · D${w[1]}`, meta: "City council", prio: 1, go, parent, cityName: r.city });
      else push({ ...base, key: r.id, scope: "city", area: ["city", r.city], ll: ll("city", r.city), title: shortRace(r), tag: shortRace(r), cityName: r.city, meta: r.city, prio: 10 + (base.who ? Math.min(base.margin, 90) : 50), go, parent });
    }
  }
  for (const [city, races] of Object.entries(byCity))
    push({ key: "cluster-" + city, scope: "cluster", area: ["city", city], ll: ll("city", city), title: city, tag: city, meta: "", cityName: city, races, prio: city === HOME ? 0.5 : 5, focus: null, go: { level: "city", id: city }, who: null, margin: 0, votes: 0, sub: null });
  return specs;
}

export const CITY_CAP = 3;   // citywide cards shown at once; the rest go behind a "+N more races" chip

export function visibleCards(all: CardSpec[], view: View, cityCd: Record<string, string>): CardSpec[] {
  const L = view.level;
  if (L === "state") return all.filter(s => s.scope === "state" || s.scope === "county");
  if (L === "county") return all.filter(s => s.scope === "county" || s.scope === "congress" || (s.scope === "cluster" && s.cityName === HOME));
  if (L === "congress") return all.filter(s => (s.scope === "congress" && s.area[1] === view.id) || (s.scope === "cluster" && cityCd[s.cityName!] === view.id));
  let out = all.filter(s => (s.scope === "city" && s.area[1] === view.id) || (s.scope === "ward" && s.cityName === view.id));
  const citywide = out.filter(s => s.scope === "city").sort((a, b) => a.prio - b.prio);
  if (citywide.length > CITY_CAP) {
    const keep = new Set(citywide.slice(0, CITY_CAP)), more = citywide.length - CITY_CAP;
    out = out.filter(s => s.scope !== "city" || keep.has(s));
    out.push({ key: "more-" + view.id, scope: "city", more: true, moreCount: more, area: ["city", view.id], ll: citywide[0].ll, title: "", tag: "", meta: "",
      who: `+${more} more races`, margin: 0, votes: 0, sub: null, prio: citywide[CITY_CAP - 1].prio + 0.01, go: view, focus: null, parent: "cluster-" + view.id });
  }
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
  [s.key, s.who, s.margin.toFixed(1), s.votes, s.sub, s.meta, s.races?.length ?? 0, s.measure ? `${s.measure.yes}/${s.measure.no}` : "", (s.people || []).map(p => p.votes).join(",")].join("~");
