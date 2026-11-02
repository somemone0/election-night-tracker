// The results card: one race in detail. Which race is the "selection", an id:
//   p40 · gov · rtm · prop-<number> · race-<race id>
// picked by clicking a card on the map or in Berkeley's strip; each level opens on a race of its own (defaultSelection).
import { GovernorBlock, PropBlock, Prop40Block, RaceItem, RtmBlock } from "../components/blocks";
import { type Ballot, ballotKey } from "../hooks/useBallot";
import { type CardSpec, rtmRace, WARD_RE } from "../lib/cards";
import { cleanTitle } from "../lib/format";
import type { HistoryPoint, Results, View } from "../types";
import { S } from "../strings";

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
    return { kicker: S.california, title: S.proposition(n), ballot: { key: S.prop(n), fallback: D.headline.name }, body: <Prop40Block D={D} history={history} full /> };
  }
  if (sel === "gov") return D.contests?.governor ? { kicker: S.california, title: S.governor, body: <GovernorBlock D={D} /> } : null;
  if (sel === "rtm") return D.rtm || rtmRace(D) ? { kicker: S.rtmCounties, title: S.measureRtm, ballot: { key: S.measureRtm }, body: <RtmBlock D={D} /> } : null;
  if (sel.startsWith("prop-")) {
    const m = D.state_measures.find(x => "prop-" + x.number === sel);
    return m ? { kicker: S.california, title: S.proposition(m.number), ballot: { key: S.prop(m.number), fallback: m.name }, body: <PropBlock m={m} /> } : null;
  }
  const r = D.races.find(x => "race-" + x.id === sel);
  if (!r) return null;
  const ward = r.city === "Berkeley" ? WARD_RE.exec(r.title)?.[1] : undefined;
  const kicker = r.group === "city" ? r.city ?? "" : r.group === "congress" && String(r.cd) === "12" ? S.includesBerkeley : S.alamedaCounty;
  const title = r.group === "congress" ? S.house(r.cd)
    : r.kind === "measure" ? r.title.replace(/\s*-\s.*$/, "")
    : ward ? S.councilDistrict(ward)
    : (r.group === "city" ? cleanTitle(r.title) || r.title : r.title.replace(/\s*\(RCV\)\s*$/, "")).replace(/^Members?,\s*/, "");
  return { kicker, title, ballot: r.kind === "measure" ? { key: ballotKey(r.title) } : undefined, body: <RaceItem r={r} /> };
}

export function Detail({ D, history, sel, ballot }: DetailProps) {
  const s = resolve(D, history, sel);
  if (!s) return <p className="empty">{S.pickRace}</p>;
  const text = s.ballot ? ballot[s.ballot.key] : undefined;
  const question = text?.question || s.ballot?.fallback?.trim();
  return (
    <>
      <div className="rhead">
        <div className="kicker">{s.kicker}</div>
        <h1>{s.title}</h1>
      </div>
      {s.body}
      {question && (
        <div className="ballot">
          <h2>{S.onTheBallot}</h2>
          <p>{question}</p>
          {!text?.question && <div className="note">{S.sosLabel}</div>}
          {text?.source && <div className="note"><a href={text.source} rel="noopener">{S.source}</a></div>}
        </div>
      )}
      <div className="foot">
        {S.sourcesLead}{" "}
        {S.sources.map(x => <span key={x.href}><a href={x.href} rel="noopener">{x.text}</a>,{" "}</span>)}
        {S.sourcesTail}
      </div>
    </>
  );
}
