// Results building blocks: two-way bars, candidate ladders, race items and the special sections (Prop 40, RTM, governor).
import { callText, cleanTitle, fmt, isChoice, measureStatus, pct, precinctMeta, progressText, threshold } from "../lib/format";
import { rtmRace, WARD_RE } from "../lib/cards";
import { DISTRICT_COLORS } from "../config";
import type { Call, HistoryPoint, MeasureCount, Race, Results, Row } from "../types";
import { Avatar } from "./Avatar";

interface Side { label: string; votes: number; pct: number; person?: string; won?: boolean }

/** "✓ Simon wins · Called" when a race has been called (see calls.py for when that happens). */
export function CallLine({ call, measure = false }: { call?: Call | null; measure?: boolean }) {
  if (!call) return null;
  const when = new Date(call.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="callline" title={call.how === "desk" ? `Called ${when}` : `Decided ${when}: the trailing side can’t catch up with the ballots left to count`}>
      <b>✓ {callText(call, measure)}</b><span>{call.how === "desk" ? "Called" : "Decided"}</span>
    </div>
  );
}

export function Duel({ a, b, th }: { a: Side; b: Side; th?: number | null }) {
  const total = a.votes + b.votes;
  const side = (x: Side, cls: string) => (
    <div className={"side " + cls + (x.won ? " won" : "")}>
      <div className="num">{total ? pct(x.pct) : "–"}</div>
      <div className="who">{x.person && !isChoice(x.person) && <Avatar name={x.person} />}{x.won && <i className="tick" aria-label="winner">✓</i>}{x.label}<em>{total ? " · " + fmt(x.votes) : ""}</em></div>
    </div>
  );
  return (
    <div className="duel">
      <div className="nums">{side(a, "a")}{side(b, "b r")}</div>
      <div className={"bar " + (th ? "th" : "mid")} style={th ? ({ "--th": th + "%" } as any) : undefined}>
        <i className="a" style={{ width: (total ? a.pct : 0) + "%" }} /><i className="b" style={{ width: (total ? b.pct : 0) + "%" }} />
      </div>
    </div>
  );
}

export function Ladder({ rows, total, limit = 6, seats = 1, won }: { rows: Row[]; total: number; limit?: number; seats?: number; won?: string[] }) {
  const max = Math.max(...rows.map(r => r.pct), 1);
  const ahead = (r: Row, i: number) => (won ? won.includes(r.name) : !!total && i < seats);
  return (
    <div className="ladder">
      {rows.slice(0, limit).map((r, i) => (
        <div key={r.name} className={"row" + (ahead(r, i) ? " lead" : "") + (won?.includes(r.name) ? " won" : "")}>
          <span className="nm"><Avatar name={r.name} />{won?.includes(r.name) && <i className="tick" aria-label="winner">✓</i>}{r.name + (r.party ? ` (${r.party})` : "")}</span>
          <span className="vv">{total ? pct(r.pct) : "–"}<em>{total ? fmt(r.votes) : ""}</em></span>
          <div className="trk"><i style={{ width: `${total ? (r.pct / max) * 100 : 0}%` }} /></div>
        </div>
      ))}
      {rows.length > limit && <div className="more">+ {rows.length - limit} more</div>}
    </div>
  );
}

/** One race. In the detail panel (detail) the title is the panel's heading, so it is left out, and every candidate is listed. */
export function RaceItem({ r, detail = false }: { r: Race; detail?: boolean }) {
  const title = r.group === "city" ? cleanTitle(r.title) || r.title : r.title.replace(/\s*\(RCV\)\s*$/, "");
  const th = threshold(r.rule);
  const ward = r.city === "Berkeley" ? WARD_RE.exec(r.title)?.[1] : undefined;   // council races carry their district's color
  const dc = ward ? DISTRICT_COLORS[ward] : undefined;
  const facts = [(r.seats ?? 1) > 1 ? `${r.seats} seats` : null, precinctMeta(r.precincts)].filter(Boolean).join(" · ");
  return (
    <div className={"item" + (dc ? " district" : "")} id={"race-" + r.id} style={dc ? ({ "--dc": dc.fill } as any) : undefined}>
      {!detail && <div className="ititle">{title}{r.rcv && <span className="tag" title="Ranked-choice voting: these are first-choice votes only">RCV</span>}</div>}
      <CallLine call={r.call} measure={r.kind === "measure"} />
      <div className="imeta">
        {r.kind === "measure" && !r.call && <><b>{measureStatus(r, r.rule)}</b>{facts && " · "}</>}{facts}
      </div>
      {r.kind === "measure" ? <Duel a={{ label: "Yes", votes: r.yes, pct: r.yes_pct, won: r.call?.winners[0] === "Yes" }} b={{ label: "No", votes: r.no, pct: r.no_pct, won: r.call?.winners[0] === "No" }} th={th > 50 ? th : null} />
        : r.rows.length === 2 && (r.seats ?? 1) === 1
          ? <Duel a={{ label: r.rows[0].name, person: r.rows[0].name, votes: r.rows[0].votes, pct: r.rows[0].pct, won: !!r.call?.winners.includes(r.rows[0].name) }}
                  b={{ label: r.rows[1].name, person: r.rows[1].name, votes: r.rows[1].votes, pct: r.rows[1].pct, won: !!r.call?.winners.includes(r.rows[1].name) }} />
          : <Ladder rows={r.rows} total={r.total} seats={r.seats} won={r.call?.winners} limit={detail ? Infinity : 6} />}
      {r.rcv && r.kind !== "measure" && <div className="note">First-choice votes only.</div>}
    </div>
  );
}

export function PairRow({ label, sub, m }: { label: string; sub?: string; m: MeasureCount }) {
  const t = m.yes + m.no;
  return (
    <div className="pair">
      <div className="lab">{label}{sub && <small>{sub}</small>}</div>
      <div className="bar mid">
        <i className="a" style={{ width: (t ? m.yes_pct : 0) + "%" }}>{t && m.yes_pct >= 15 ? `Yes ${pct(m.yes_pct)}` : ""}</i>
        <i className="b" style={{ width: (t ? m.no_pct : 0) + "%" }}>{t && m.no_pct >= 15 ? `No ${pct(m.no_pct)}` : ""}</i>
      </div>
    </div>
  );
}

/* ---- Prop 40 ---- */
export function Prop40Block({ D, history, full }: { D: Results; history: HistoryPoint[]; full: boolean }) {
  const h = D.headline, st = h.state;
  return (
    <>
      <CallLine call={st?.call} measure />
      <div id="p40">{st && <PairRow label="Statewide" sub={st.precincts ? pct(st.precincts.pct, 0) + " in" : ""} m={st} />}</div>
      {full && st && (
        <table className="t">
          <thead><tr>{["", "Yes", "Yes %", "No", "No %"].map(t => <th key={t}>{t}</th>)}</tr></thead>
          <tbody><tr><td>Statewide</td><td className="n">{fmt(st.yes)}</td><td className="n">{pct(st.yes_pct)}</td><td className="n">{fmt(st.no)}</td><td className="n">{pct(st.no_pct)}</td></tr></tbody>
        </table>
      )}
      {full && history.filter(p => p.state_yes_pct != null).length >= 2 && (
        <div className="item lc">
          <div className="ititle">Yes share over time</div>
          <LineChart history={history} />
        </div>
      )}
    </>
  );
}

function LineChart({ history }: { history: HistoryPoint[] }) {
  const pts = history.filter(p => p.state_yes_pct != null);
  const W = 420, H = 190, L = 34, R = 104, T = 12, B = 28;
  const vals = pts.map(p => p.state_yes_pct as number);
  const lo = Math.max(0, Math.floor(Math.min(...vals, 50) / 5) * 5 - 5), hi = Math.min(100, Math.ceil(Math.max(...vals, 50) / 5) * 5 + 5);
  const x = (i: number) => L + (i / (pts.length - 1)) * (W - L - R), y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks: number[] = []; for (let v = lo; v <= hi; v += 5) ticks.push(v);
  const lv = vals[vals.length - 1], li = pts.length - 1;
  const lab = (p: HistoryPoint) => (p.sos_time || "").replace(/^[A-Za-z]+ (\d+), \d+, /, "");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Yes share of the vote on Prop 40 over time">
      {ticks.map(v => <g key={v}>
        <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 50 ? "#FFFFFF" : "rgba(255,255,255,.14)"} strokeDasharray={v === 50 ? "4 3" : undefined} />
        <text x={L - 5} y={y(v) + 4} textAnchor="end" fontSize={10} fill="#A4A9A6">{v}%</text>
      </g>)}
      <polyline points={vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none" stroke="#FFFFFF" strokeWidth={2.2} strokeLinejoin="round" />
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
  return (
    <>
      {!R ? <RaceItem r={ala!} detail /> : (
        <div className="item" id="rtm">
          <div className="ititle">Five-county total</div>
          <CallLine call={R.total.call} measure />
          <div className="imeta">{R.total.call ? "" : <><b>{measureStatus(R.total, R.rule)}</b> · </>}{R.counties_in} of 5 counties</div>
          <Duel a={{ label: "Yes", votes: R.total.yes, pct: R.total.yes_pct, won: R.total.call?.winners[0] === "Yes" }} b={{ label: "No", votes: R.total.no, pct: R.total.no_pct, won: R.total.call?.winners[0] === "No" }} />
          {!R.complete && <div className="note">Partial until all five counties report.</div>}
        </div>
      )}
    </>
  );
}

/* ---- Governor ---- */
export function GovernorBlock({ D }: { D: Results }) {
  const g = D.contests?.governor;
  if (!g || !(g.state || g.alameda)) return null;
  return (
    <>
      {([["Statewide", g.state, "gov-state"], ["Alameda County", g.alameda, "gov-alameda"]] as const).map(([label, c, id]) => c && (
        <div className="item" id={id} key={id}>
          <div className="ititle">{label}</div>
          <CallLine call={c.call} />
          <div className="imeta">{progressText(c.precincts)}</div>
          {c.candidates.length === 2
            ? <Duel a={{ label: `${c.candidates[0].name} (${c.candidates[0].party})`, person: c.candidates[0].name, votes: c.candidates[0].votes, pct: c.candidates[0].pct, won: !!c.call?.winners.includes(c.candidates[0].name) }}
                    b={{ label: `${c.candidates[1].name} (${c.candidates[1].party})`, person: c.candidates[1].name, votes: c.candidates[1].votes, pct: c.candidates[1].pct, won: !!c.call?.winners.includes(c.candidates[1].name) }} />
            : <Ladder rows={c.candidates} total={c.total} won={c.call?.winners} />}
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
      <div className="ititle">Statewide</div>
      <CallLine call={s.call} measure />
      <div className="imeta">{!s.call && <b>{measureStatus(s, null)}</b>}{s.precincts ? ` · ${progressText(s.precincts)}` : ""}</div>
      <Duel a={{ label: "Yes", votes: s.yes, pct: s.yes_pct, won: s.call?.winners[0] === "Yes" }} b={{ label: "No", votes: s.no, pct: s.no_pct, won: s.call?.winners[0] === "No" }} />
      {m.alameda && m.alameda.yes + m.alameda.no > 0 && <PairRow label="Alameda County" m={m.alameda} />}
    </div>
  );
}
