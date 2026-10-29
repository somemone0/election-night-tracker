// The results card: one race in detail. Which race is the "selection", an id:
//   p40 · gov · rtm · prop-<number> · race-<race id>
// picked by clicking a card on the map or in Berkeley's strip; each level opens on a race of its own (defaultSelection).
import { GovernorBlock, PropBlock, Prop40Block, RaceItem, RtmBlock } from "../components/blocks";
import { type Ballot, ballotKey } from "../hooks/useBallot";
import { type CardSpec, rtmRace, WARD_RE } from "../lib/cards";
import { cleanTitle } from "../lib/format";
import type { HistoryPoint, Results, View } from "../types";

export interface DetailProps { D: Results; history: HistoryPoint[]; sel: string; ballot: Ballot }

export function defaultSelection(D: Results | null, view: View, strip: CardSpec[]): string {
  if (view.level === "state") return "p40";
  if (view.level === "city") return strip[0]?.focus ?? "rtm";
  if (D?.rtm || rtmRace(D)) return "rtm";
  const cd = D?.races.find(r => r.group === "congress" && String(r.cd) === "12");
  return cd ? "race-" + cd.id : "p40";
}

interface Shown { kicker: string; title: string; ballot?: { key: string; fallback?: string }; body: JSX.Element }

function resolve(D: Results, history: HistoryPoint[], sel: string): Shown | null {
  if (sel === "p40") {
    const n = D.headline.number;
    return { kicker: "California · statewide", title: `Proposition ${n}`, ballot: { key: `Prop ${n}`, fallback: D.headline.name }, body: <Prop40Block D={D} history={history} full /> };
  }
  if (sel === "gov") return D.contests?.governor ? { kicker: "California · statewide", title: "Governor", body: <GovernorBlock D={D} /> } : null;
  if (sel === "rtm") return D.rtm || rtmRace(D) ? { kicker: "Five Bay Area counties", title: "Measure RTM", ballot: { key: "Measure RTM" }, body: <RtmBlock D={D} /> } : null;
  if (sel.startsWith("prop-")) {
    const m = D.state_measures.find(x => "prop-" + x.number === sel);
    return m ? { kicker: "California · statewide", title: `Proposition ${m.number}`, ballot: { key: `Prop ${m.number}`, fallback: m.name }, body: <PropBlock m={m} /> } : null;
  }
  const r = D.races.find(x => "race-" + x.id === sel);
  if (!r) return null;
  const ward = r.city === "Berkeley" ? WARD_RE.exec(r.title)?.[1] : undefined;
  const kicker = r.group === "city" ? [r.city, ward ? `Council District ${ward}` : r.kind === "measure" ? "City measure" : "Citywide", r.rcv ? "Ranked choice" : ""].filter(Boolean).join(" · ")
    : r.group === "congress" ? `U.S. House · ${r.cd === 12 || r.cd === "12" ? "includes Berkeley" : "Alameda County"}`
    : r.kind === "measure" ? "Alameda County measure" : "Alameda County";
  const title = r.group === "congress" ? `U.S. House, District ${r.cd}`
    : r.kind === "measure" ? r.title.replace(/\s*-\s.*$/, "")
    : ward ? `City Council, District ${ward}`
    : (r.group === "city" ? cleanTitle(r.title) || r.title : r.title.replace(/\s*\(RCV\)\s*$/, "")).replace(/^Members?,\s*/, "");
  return { kicker, title, ballot: r.kind === "measure" ? { key: ballotKey(r.title) } : undefined, body: <RaceItem r={r} detail /> };
}

export function Detail({ D, history, sel, ballot }: DetailProps) {
  const s = resolve(D, history, sel);
  if (!s) return <p className="empty">Pick a race on the map.</p>;
  const text = s.ballot ? ballot[s.ballot.key] : undefined;
  const question = text?.question ?? s.ballot?.fallback?.trim();
  return (
    <>
      <div className="rhead">
        <div className="kicker">{s.kicker}</div>
        <h1>{s.title}</h1>
      </div>
      {s.body}
      {question && (
        <div className="ballot">
          <h2>On the ballot</h2>
          <p>{question}</p>
          {!text && <div className="note">Ballot label from the Secretary of State.</div>}
          {text?.source && <div className="note"><a href={text.source} rel="noopener">Source</a></div>}
        </div>
      )}
      <div className="foot">
        Unofficial results. Sources:{" "}
        <a href="https://www.sos.ca.gov/elections/prior-elections/statewide-election-results" rel="noopener">California Secretary of State</a>,{" "}
        <a href="https://acvote.alamedacountyca.gov/" rel="noopener">Alameda County Registrar of Voters</a>, RTM county registrars.
      </div>
    </>
  );
}
