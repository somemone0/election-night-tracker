import type { MeasureCount, Precincts } from "../types";

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
  if (!(m.yes + m.no)) return "No votes counted yet";
  const th = threshold(rule);
  if (th > 50) return `Yes at ${pct(m.yes_pct)}, needs ${pct(th, th % 1 ? 1 : 0)}`;
  if (m.leader === "tied") return "Tied";
  return `${m.leader === "yes" ? "Yes" : "No"} leads by ${m.margin.toFixed(1)} pts`;
}

export const precinctMeta = (p?: Precincts | null) => (p ? `${fmt(p.done)} of ${fmt(p.total)} precincts` : null);
export const progressText = (p?: Precincts | null) => (p ? `${pct(p.pct, p.pct % 1 ? 1 : 0)} of precincts reporting` : "");
