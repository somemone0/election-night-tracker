// What each measure is, from site/measures.json: a one-line label written by the desk and a link to the Daily
// Californian article that describes it (none of the results feeds carry either). Fetched once; missing or broken is fine.
import { useEffect, useState } from "react";
import { CONFIG } from "../config";

export interface BallotText { short?: string; source?: string; story?: string }   // short: one-line label; source/story: the article's link and headline
export type Ballot = Record<string, BallotText>;

/** "Bond Measure U - City of Berkeley" -> "Measure U"; "Prop 40" stays. Keys in measures.json use this form. */
export const ballotKey = (title: string) => title.replace(/\s*-\s.*$/, "").replace(/^Bond\s+/i, "").trim();

export function useBallot(): Ballot {
  const [b, setB] = useState<Ballot>({});
  useEffect(() => {
    fetch(CONFIG.measures, { cache: "no-cache" }).then(r => (r.ok ? r.json() : {})).then((j: { measures?: Record<string, unknown> }) => {
      const out: Ballot = {};
      for (const [k, v] of Object.entries((j && j.measures) || {})) {
        const t = v as Partial<BallotText>;
        const str = (x: unknown) => (typeof x === "string" && x.trim()) || undefined;
        const e = { short: str(t?.short), source: str(t?.source), story: str(t?.story) };
        if (e.short || e.source) out[k] = e;
      }
      setB(out);
    }).catch(() => {});
  }, []);
  return b;
}
