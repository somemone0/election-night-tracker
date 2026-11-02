// Ballot question text for measures, from site/measures.json (typed in by the desk from the county's sample ballot and
// the Secretary of State's voter guide; none of the results feeds carry it). Fetched once; missing or broken is fine.
import { useEffect, useState } from "react";
import { CONFIG } from "../config";

export interface BallotText { question: string; source?: string; short?: string }   // short: the broadcast's one-line label
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
        const question = typeof t?.question === "string" ? t.question.trim() : "", short = typeof t?.short === "string" ? t.short.trim() : "";
        if (question || short) out[k] = { question, source: typeof t.source === "string" && t.source ? t.source : undefined, short: short || undefined };
      }
      setB(out);
    }).catch(() => {});
  }, []);
  return b;
}
