// Results building blocks, set like a newspaper's results page: an AP-style table per race (check, name, votes, pct.),
// a one-line call note, and the special sections (Prop 40, RTM, governor, the other propositions).
import { apDateTime, apNum, callText, fmt, measureStatus, pct, precinctMeta, progressText, threshold } from "../lib/format";
import { rtmRace, WARD_RE } from "../lib/cards";
import { DISTRICT_COLORS } from "../config";
import type { Call, HistoryPoint, MeasureCount, Race, Results, Row } from "../types";
import { Avatar } from "./Avatar";
import { S } from "../strings";

/** "✓ Simon wins. Called by The Daily Californian at 11:42 p.m. Nov. 4." (see calls.py for when races are called). */
export function CallLine({ call, measure = false }: { call?: Call | null; measure?: boolean }) {
  if (!call) return null;
  const when = apDateTime(new Date(call.at));
  return (
    <p className="callline">
      <b>✓ {callText(call, measure)}.</b>{" "}
      {call.how === "desk" ? S.calledBy(when) : S.decidedAt(when)}
    </p>
  );
}

interface Line { name: string; votes: number; pct: number; party?: string; won?: boolean; lead?: boolean; photo?: boolean }

/** Check, name, votes, pct. The leader (or the winners) set in bold. */
export function ResultTable({ lines, total, label = S.candidate }: { lines: Line[]; total: number; label?: string }) {
  return (
    <table className="rt">
      <thead><tr><th className="ck"><span className="sr">{S.winner}</span></th><th className="nm">{label}</th><th className="n">{S.votes}</th><th className="n">{S.pctHead}</th></tr></thead>
      <tbody>
        {lines.map(l => (
          <tr key={l.name} className={l.won ? "won" : l.lead ? "lead" : undefined}>
            <td className="ck">{l.won ? "✓" : ""}</td>
            <td className="nm"><span className="nmw">{l.photo && <Avatar name={l.name} />}<span>{l.name}{l.party && <span className="party"> ({l.party})</span>}</span></span></td>
            <td className="n">{total ? fmt(l.votes) : S.none}</td>
            <td className="n">{total ? pct(l.pct) : S.none}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const candidateLines = (rows: Row[], total: number, seats: number, won?: string[]): Line[] =>
  rows.map((r, i) => ({ name: r.name, votes: r.votes, pct: r.pct, party: r.party, photo: true, won: !!won?.includes(r.name), lead: !won && !!total && i < seats }));

const measureLines = (m: MeasureCount, won?: string): Line[] => [
  { name: S.yes, votes: m.yes, pct: m.yes_pct, won: won === "Yes", lead: !won && m.leader === "yes" },
  { name: S.no, votes: m.no, pct: m.no_pct, won: won === "No", lead: !won && m.leader === "no" },
];

const sentence = (s: string) => (s ? s + "." : "");

/** One race, in full. Its title is the panel's heading, so it is not repeated here. */
export function RaceItem({ r }: { r: Race }) {
  const th = threshold(r.rule);
  const ward = r.city === "Berkeley" ? WARD_RE.exec(r.title)?.[1] : undefined;   // council races carry their district's color
  const dc = ward ? DISTRICT_COLORS[ward] : undefined;
  const seats = r.seats ?? 1;
  const facts = [seats > 1 ? S.voteFor(apNum(seats)) : null, r.kind === "measure" && th > 50 ? S.needsToPass(th > 60 ? S.twoThirds : pct(th, 0)) : null,
    r.precincts ? S.reporting(precinctMeta(r.precincts)) : null].filter(Boolean).join(". ");
  return (
    <div className={"item" + (dc ? " district" : "")} id={"race-" + r.id} style={dc ? ({ "--dc": dc.fill } as any) : undefined}>
      <CallLine call={r.call} measure={r.kind === "measure"} />
      <div className="imeta">{r.kind === "measure" && !r.call && <><b>{measureStatus(r, r.rule)}.</b> </>}{sentence(facts)}</div>
      {r.kind === "measure"
        ? <ResultTable lines={measureLines(r, r.call?.winners[0])} total={r.yes + r.no} label="" />
        : <ResultTable lines={candidateLines(r.rows, r.total, seats, r.call?.winners)} total={r.total} />}
      {r.rcv && r.kind !== "measure" && <div className="note">{S.rcvNote}</div>}
    </div>
  );
}

/* ---- Prop 40 ---- */
export function Prop40Block({ D, history, full }: { D: Results; history: HistoryPoint[]; full: boolean }) {
  const st = D.headline.state, ala = D.headline.alameda;
  if (!st) return <p className="empty">{S.propNotPosted(D.headline.number)}</p>;
  return (
    <div className="item" id="p40">
      <CallLine call={st.call} measure />
      <div className="imeta">{!st.call && <><b>{measureStatus(st, null)}.</b> </>}{sentence(progressText(st.precincts))}</div>
      <ResultTable lines={measureLines(st, st.call?.winners[0])} total={st.yes + st.no} label={S.statewide} />
      {ala && ala.yes + ala.no > 0 && <div className="note">{S.inAlameda(pct(ala.yes_pct), pct(ala.no_pct))}</div>}
      {full && history.filter(p => p.state_yes_pct != null).length >= 2 && (
        <div className="lc">
          <h2>{S.yesOverTime}</h2>
          <LineChart history={history} n={D.headline.number} />
        </div>
      )}
    </div>
  );
}

function LineChart({ history, n }: { history: HistoryPoint[]; n: string }) {
  const pts = history.filter(p => p.state_yes_pct != null);
  const W = 420, H = 190, L = 34, R = 104, T = 12, B = 28;
  const vals = pts.map(p => p.state_yes_pct as number);
  const lo = Math.max(0, Math.floor(Math.min(...vals, 50) / 5) * 5 - 5), hi = Math.min(100, Math.ceil(Math.max(...vals, 50) / 5) * 5 + 5);
  const x = (i: number) => L + (i / (pts.length - 1)) * (W - L - R), y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks: number[] = []; for (let v = lo; v <= hi; v += 5) ticks.push(v);
  const lv = vals[vals.length - 1], li = pts.length - 1;
  const lab = (p: HistoryPoint) => { const d = new Date(p.t); return isNaN(+d) ? "" : apDateTime(d); };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={S.yesOverTimeLabel(n)}>
      {ticks.map(v => <g key={v}>
        <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 50 ? "#FFFFFF" : "rgba(255,255,255,.14)"} strokeDasharray={v === 50 ? "4 3" : undefined} />
        <text x={L - 5} y={y(v) + 4} textAnchor="end" fontSize={10} fill="#A4A9A6">{v}%</text>
      </g>)}
      <polyline points={vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinejoin="round" />
      <circle cx={x(li)} cy={y(lv)} r={3} fill="#FFFFFF" />
      <text className="lv" x={x(li) + 7} y={y(lv) + 4} fontSize={11} fill="#FFFFFF">{lv.toFixed(1)}%</text>
      <text x={L} y={H - 8} fontSize={10} fill="#A4A9A6">{lab(pts[0])}</text>
      <text x={W - R} y={H - 8} textAnchor="end" fontSize={10} fill="#A4A9A6">{lab(pts[li])}</text>
    </svg>
  );
}

/* ---- Measure RTM: decided by the combined vote of five counties; the tracker adds them up (D.rtm) ---- */
export function RtmBlock({ D }: { D: Results }) {
  const R = D.rtm, ala = rtmRace(D);
  if (!R && !ala) return null;
  if (!R) return <RaceItem r={ala!} />;
  return (
    <div className="item" id="rtm">
      <CallLine call={R.total.call} measure />
      <div className="imeta">{!R.total.call && <><b>{measureStatus(R.total, R.rule)}.</b> </>}{S.countiesReporting(R.counties_in)}</div>
      <ResultTable lines={measureLines(R.total, R.total.call?.winners[0])} total={R.total.yes + R.total.no} label={S.fiveCounties} />
      {!R.complete && <div className="note">{S.partialCounties}</div>}
    </div>
  );
}

/* ---- Governor ---- */
export function GovernorBlock({ D }: { D: Results }) {
  const g = D.contests?.governor;
  if (!g || !(g.state || g.alameda)) return null;
  return (
    <>
      {([["state", g.state, "gov-state"], ["alameda", g.alameda, "gov-alameda"]] as const).map(([where, c, id]) => c && (
        <div className="item" id={id} key={id}>
          {where === "state" ? <CallLine call={c.call} /> : <h2>{S.inAlamedaHead}</h2>}
          <div className="imeta">{sentence(progressText(c.precincts))}</div>
          <ResultTable lines={candidateLines(c.candidates, c.total, 1, c.call?.winners)} total={c.total} />
        </div>
      ))}
    </>
  );
}

/* ---- the other statewide propositions ---- */
export function PropBlock({ m }: { m: Results["state_measures"][number] }) {
  const s = m.state;
  return (
    <div className="item" id={"prop-" + m.number}>
      <CallLine call={s.call} measure />
      <div className="imeta">{!s.call && <><b>{measureStatus(s, null)}.</b> </>}{sentence(progressText(s.precincts))}</div>
      <ResultTable lines={measureLines(s, s.call?.winners[0])} total={s.yes + s.no} label={S.statewide} />
      {m.alameda && m.alameda.yes + m.alameda.no > 0 && <div className="note">{S.inAlameda(pct(m.alameda.yes_pct), pct(m.alameda.no_pct))}</div>}
    </div>
  );
}
