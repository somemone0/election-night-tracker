import { S } from "../strings";
import type { Call, MeasureCount, Precincts } from "../types";

export const fmt = (n: number) => Number(n || 0).toLocaleString("en-US");
export const pct = (n: number, d = 1) => `${Number(n || 0).toFixed(d)}%`;
export const last = (n: string) => n.split(" ").slice(-1)[0];
export const cleanTitle = (t: string) =>
  t.replace(/\s*\(RCV\)\s*$/, "").replace(/\s*-\s*(City of )?[A-Z][A-Za-z ]+$/, "").replace(/\s*-\s*City of .*$/, "");
export const isChoice = (n?: string | null) => /^(Yes|No|Bonds Yes|Bonds No)$/i.test(n || "");

export function threshold(rule?: string | null) {
  if (!rule) return 50;
  if (/two[- ]thirds|2\/3|66(\.\d+)?\s*%/i.test(rule)) return 66.67;
  if (/55\s*%/.test(rule)) return 55;
  return 50;
}

export function measureStatus(m: MeasureCount, rule?: string | null) {
  if (!(m.yes + m.no)) return S.noVotes;
  const th = threshold(rule);
  if (th > 50) return S.yesNeeds(pct(m.yes_pct), pct(th, th % 1 ? 1 : 0));
  if (m.leader === "tied") return S.tied;
  return S.sideLeads(m.leader === "yes" ? S.yes : S.no, m.margin.toFixed(1));
}

/** "Simon wins", "Ishii, Lunaparra win", "Passes", "Fails". */
export function callText(c: Call, measure: boolean, short: (n: string) => string = n => n) {
  if (measure) return c.winners[0] === "Yes" ? S.passes : S.fails;
  return S.wins(c.winners.map(short));
}

/** AP style: "9:42 p.m.", "10 a.m.", "noon", "midnight". */
export function apTime(d: Date) {
  const h = d.getHours(), m = d.getMinutes();
  if (m === 0 && h === 12) return S.noon;
  if (m === 0 && h === 0) return S.midnight;
  return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? S.am : S.pm}`;
}
/** AP style, time before date: "11:42 p.m. Nov. 4" */
export const apDateTime = (d: Date) => `${apTime(d)} ${S.months[d.getMonth()]} ${d.getDate()}`;
/** AP style numbers: one through nine spelled out. */
export const apNum = (n: number) => (n >= 1 && n <= 9 ? S.digits[n] : fmt(n));

export const precinctMeta = (p?: Precincts | null) => (p ? S.precincts(fmt(p.done), fmt(p.total)) : null);
export const progressText = (p?: Precincts | null) => (p ? S.precinctsReporting(pct(p.pct, p.pct % 1 ? 1 : 0)) : "");
