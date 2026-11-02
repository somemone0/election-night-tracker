// What the Instagram broadcast shows: a loop of slides (Berkeley council, measures, school board, the Bay Area, the
// state), built from results.json. Pure functions, so the loop can be tested without a browser.
import type { Ballot } from "../hooks/useBallot";
import { rtmRace, WARD_RE } from "../lib/cards";
import { threshold } from "../lib/format";
import type { Call, MeasureCount, Precincts, Race, Results, Row } from "../types";
import { S } from "../strings";

export interface BroadcastConfig { slideSeconds: number; stateProps: string[]; parties: Record<string, string> }
export const DEFAULT_CONFIG: BroadcastConfig = { slideSeconds: 8, stateProps: ["40"], parties: {} };

export interface Cand { name: string; pct: number; party: "D" | "R" | null; win: boolean }
export interface CandBlock {
  kind: "cands"; key: string; title: string; pctIn: number | null; called: boolean; counted: boolean;
  cands: Cand[]; margin: number | null;    // margin: leader minus runner-up, for one-seat races
  cut: string | null;                      // "Top five win", drawn under the winning places in multi-seat races
  seats: number; partisan: boolean; small: boolean;
  ward?: string;                           // council district number, for its cutout color
}
export interface MeasureBlock { kind: "measure"; key: string; letter: string; label: string; yes: number; counted: boolean; th: number; needs: string; called: boolean }
export interface BigBlock { kind: "big"; key: string; title: string; label: string; yes: number; no: number; counted: boolean; th: number; needs: string; pctIn: number | null; called: boolean }
export type Block = CandBlock | MeasureBlock | BigBlock;
/** tab: the name in the tab bar; kicker over the section title, as on the website's detail panel */
export interface Slide { key: string; tab: string; kicker: string; section: string; note: string | null; blocks: Block[] }

/** "Majdi 'Gaith' Abuhamdieh" -> "Majdi Abuhamdieh"; "Igor A. Tregub" -> "Igor Tregub" (room for 45px type). */
export const displayName = (n: string) =>
  n.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+['"“‘][^'"”’]+['"”’]\s*/g, " ").replace(/\s+[A-Z]\.(?=\s)/g, "").replace(/\s+/g, " ").trim();

const partyOf = (row: Row, cfg: BroadcastConfig): "D" | "R" | null => {
  const p = (row.party || cfg.parties[row.name] || "").toLowerCase();
  return /^d/.test(p) ? "D" : /^r/.test(p) ? "R" : null;
};
const pctIn = (p?: Precincts | null) => (p ? p.pct : null);
const needsText = (th: number) => (th > 60 ? S.twoThirds : th === 50 ? S.bc.majority : `${Math.round(th)}%`);

function cands(key: string, title: string, rows: Row[], total: number, seats: number, p: Precincts | null | undefined, call: Call | undefined, cfg: BroadcastConfig, max = seats + 1): CandBlock {
  const shown = rows.slice(0, Math.max(max, seats + 1));
  const counted = total > 0;
  const list = shown.map((r, i) => ({ name: displayName(r.name), pct: r.pct, party: partyOf(r, cfg), win: call ? call.winners.includes(r.name) : counted && i < seats }));
  return {
    kind: "cands", key, title, pctIn: pctIn(p), called: !!call, counted, cands: list, seats,
    margin: seats === 1 && rows.length >= 2 && counted ? rows[0].pct - rows[1].pct : null,
    cut: seats > 1 && rows.length > seats ? S.bc.topWin(seats) : null,
    partisan: list.length > 0 && list.every(c => c.party), small: shown.length > 3,
  };
}

const measureLetter = (title: string) => /Measure\s+([A-Z]{1,3})\b/.exec(title)?.[1] ?? "?";

function measureBig(key: string, title: string, label: string, m: MeasureCount, rule: string | null | undefined, p: Precincts | null | undefined): BigBlock {
  const th = threshold(rule);
  return { kind: "big", key, title, label, yes: m.yes_pct, no: m.no_pct, counted: m.yes + m.no > 0, th, needs: needsText(th), pctIn: pctIn(p), called: !!m.call };
}

export function buildSlides(D: Results | null, ballot: Ballot, cfg: BroadcastConfig = DEFAULT_CONFIG): Slide[] {
  if (!D) return [];
  const out: Slide[] = [];
  const berk = D.races.filter(r => r.city === "Berkeley");
  const cand = (r: Race | undefined) => (r && r.kind === "candidate" ? r : undefined);

  // 1. City council (and the rent board, which is elected at large the same night)
  const wards = berk.map(r => ({ r: cand(r), n: WARD_RE.exec(r.title)?.[1] })).filter((x): x is { r: Race & { kind: "candidate" }; n: string } => !!x.r && !!x.n)
    .sort((a, b) => Number(a.n) - Number(b.n));
  const rent = cand(berk.find(r => /Rent Stabilization/i.test(r.title)));
  const council: Block[] = wards.map(({ r, n }) => ({ ...cands(r.id, S.district(n), r.rows, r.total, r.seats ?? 1, r.precincts, r.call, cfg), ward: n }));
  if (rent) council.push(cands(rent.id, S.bc.rentBoard, rent.rows, rent.total, rent.seats ?? 1, rent.precincts, rent.call, cfg, (rent.seats ?? 1) + 1));
  if (council.length) out.push({ key: "council", tab: S.bc.tabs.council, kicker: S.bc.kickers.berkeley, section: S.bc.sections.council, note: wards.some(w => w.r.rcv) ? S.bc.rcvNote : null, blocks: council });

  // 2. Berkeley's measures
  const meas = berk.filter(r => r.kind === "measure") as (Race & { kind: "measure" })[];
  if (meas.length) out.push({
    key: "measures", tab: S.bc.tabs.measures, kicker: S.bc.kickers.berkeley, section: S.bc.sections.measures, note: null,
    blocks: meas.map(r => {
      const letter = measureLetter(r.title), th = threshold(r.rule);
      return { kind: "measure", key: r.id, letter, label: ballot[S.measure(letter)]?.short ?? r.title.replace(/\s*-\s.*$/, ""), yes: r.yes_pct, counted: r.yes + r.no > 0, th, needs: needsText(th), called: !!r.call } as MeasureBlock;
    }),
  });

  // 3. School board (and any other citywide office with a real contest)
  const school = cand(berk.find(r => /School Directors/i.test(r.title)));
  if (school) out.push({ key: "school", tab: S.bc.tabs.school, kicker: S.bc.kickers.berkeley, section: S.bc.sections.school, note: null,
    blocks: [cands(school.id, S.bc.schoolBoard, school.rows, school.total, school.seats ?? 1, school.precincts, school.call, cfg, (school.seats ?? 1) + 1)] });

  // 4. Measure RTM, five counties combined, and any countywide measures
  const bay: Block[] = [];
  const rtmA = rtmRace(D), label = ballot[S.measureRtm]?.short ?? S.bc.rtmFallback;
  if (D.rtm) {
    const ps = D.rtm.counties.map(c => c.precincts).filter((p): p is Precincts => !!p);
    const done = ps.reduce((s, p) => s + p.done, 0), total = ps.reduce((s, p) => s + p.total, 0);
    bay.push(measureBig("rtm", S.measureRtm, label, D.rtm.total, D.rtm.rule, total ? { done, total, pct: (100 * done) / total } : null));
  } else if (rtmA && rtmA.kind === "measure") bay.push(measureBig("rtm", S.measureRtm, label, rtmA, rtmA.rule, rtmA.precincts));
  for (const r of D.races.filter(r => r.group === "county" && r.category === "Measures" && r !== rtmA && r.kind === "measure") as (Race & { kind: "measure" })[]) {
    const letter = measureLetter(r.title);
    bay.push(measureBig(r.id, S.measure(letter), ballot[S.measure(letter)]?.short ?? r.title.replace(/^.*?-\s*/, ""), r, r.rule, r.precincts));
  }
  if (bay.length) out.push({ key: "bay", tab: S.bc.tabs.bay, kicker: S.rtmCounties, section: S.bc.sections.bay, note: null, blocks: bay });

  // 5. California: governor, CA-12, propositions
  const state: Block[] = [];
  const gov = D.contests?.governor?.state;
  if (gov) state.push(cands("gov", S.governor, gov.candidates, gov.total, 1, gov.precincts, gov.call, cfg));
  const cd12 = cand(D.races.find(r => r.group === "congress" && String(r.cd) === "12"));
  if (cd12) state.push(cands(cd12.id, S.bc.congress, cd12.rows, cd12.total, 1, cd12.precincts, cd12.call, cfg));
  const props = [...new Set([...cfg.stateProps, D.headline?.number].filter(Boolean) as string[])].sort((a, b) => Number(a) - Number(b));
  for (const n of props) {
    const m = n === D.headline?.number ? D.headline.state : D.state_measures.find(x => x.number === n)?.state;
    if (m) state.push(measureBig("prop-" + n, S.prop(n), ballot[S.prop(n)]?.short ?? "", m, null, m.precincts ?? (n === D.headline?.number ? D.headline.state?.precincts : null)));
  }
  if (state.length) out.push({ key: "state", tab: S.bc.tabs.state, kicker: S.california, section: S.bc.sections.state, note: null, blocks: state });
  return out;
}
