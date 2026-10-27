// Results building blocks: two-way bars, candidate ladders, race items and the special sections (Prop 40, RTM, governor).
import { cleanTitle, fmt, isChoice, measureStatus, pct, precinctMeta, progressText, threshold } from "../lib/format";
import { rtmRace } from "../lib/cards";
import type { HistoryPoint, MeasureCount, Race, Results, Row } from "../types";
import { Avatar } from "./Avatar";

interface Side { label: string; votes: number; pct: number; person?: string }

export function Duel({ a, b, th }: { a: Side; b: Side; th?: number | null }) {
  const total = a.votes + b.votes;
  const side = (x: Side, cls: string) => (
    <div className={"side " + cls}>
      <div className="num">{total ? pct(x.pct) : "–"}</div>
      <div className="who">{x.person && !isChoice(x.person) && <Avatar name={x.person} />}{x.label}<em>{total ? " · " + fmt(x.votes) : ""}</em></div>
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

export function Ladder({ rows, total, limit = 6 }: { rows: Row[]; total: number; limit?: number }) {
  const max = Math.max(...rows.map(r => r.pct), 1);
  return (
    <div className="ladder">
      {rows.slice(0, limit).map((r, i) => (
        <div key={r.name} className={"row" + (total && i === 0 ? " lead" : "")}>
          <span className="nm"><Avatar name={r.name} />{r.name + (r.party ? ` (${r.party})` : "")}</span>
          <span className="vv">{total ? pct(r.pct) : "–"}<em>{total ? fmt(r.votes) : ""}</em></span>
          <div className="trk"><i style={{ width: `${total ? (r.pct / max) * 100 : 0}%` }} /></div>
        </div>
      ))}
      {rows.length > limit && <div className="more">+ {rows.length - limit} more</div>}
    </div>
  );
}

export function RaceItem({ r }: { r: Race }) {
  const title = r.group === "city" ? cleanTitle(r.title) || r.title : r.title.replace(/\s*\(RCV\)\s*$/, "");
  const th = threshold(r.rule);
  return (
    <div className="item" id={"race-" + r.id}>
      <div className="ititle">{title}{r.rcv && <span className="tag" title="Ranked-choice voting: these are first-choice votes only">RCV</span>}</div>
      <div className="imeta">
        {r.kind === "measure" && <b>{measureStatus(r, r.rule)}</b>}
        {r.precincts && (r.kind === "measure" ? " · " : "") + precinctMeta(r.precincts)}
      </div>
      {r.kind === "measure" ? <Duel a={{ label: "Yes", votes: r.yes, pct: r.yes_pct }} b={{ label: "No", votes: r.no, pct: r.no_pct }} th={th > 50 ? th : null} />
        : r.rows.length === 2 ? <Duel a={{ label: r.rows[0].name, person: r.rows[0].name, votes: r.rows[0].votes, pct: r.rows[0].pct }} b={{ label: r.rows[1].name, person: r.rows[1].name, votes: r.rows[1].votes, pct: r.rows[1].pct }} />
        : <Ladder rows={r.rows} total={r.total} />}
      {r.rcv && r.kind !== "measure" && <div className="note">First-choice votes only. Ranked-choice rounds are published separately by the county.</div>}
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
  let lede = "No votes have been reported yet. Results are expected after polls close at 8 p.m.";
  if (st && st.yes + st.no > 0)
    lede = `With ${progressText(st.precincts) || "early returns"}, Prop 40 is ${st.leader === "yes" ? "ahead" : st.leader === "no" ? "trailing" : "tied"} statewide, ${pct(st.yes_pct)} yes to ${pct(st.no_pct)} no. Late-counted ballots can move these numbers.`;
  return (
    <>
      <h2>Proposition 40</h2>
      <div className="imeta" style={{ marginTop: 8 }}>{(h.name || "").replace(/\.\s*Initiative.*$/, "") || "One-time tax on certain taxpayers"}</div>
      {full && <p className="lede">{lede}</p>}
      <div id="p40">{st && <PairRow label="Statewide" sub={st.precincts ? pct(st.precincts.pct, 0) + " in" : ""} m={st} />}</div>
      {full && st && (
        <table className="t">
          <thead><tr>{["", "Yes", "Yes %", "No", "No %"].map(t => <th key={t}>{t}</th>)}</tr></thead>
          <tbody><tr><td>Statewide</td><td className="n">{fmt(st.yes)}</td><td className="n">{pct(st.yes_pct)}</td><td className="n">{fmt(st.no)}</td><td className="n">{pct(st.no_pct)}</td></tr></tbody>
        </table>
      )}
      {full && (
        <div className="item lc">
          <div className="ititle">Yes share as counting progresses</div>
          <div className="legend2"><span><i style={{ background: "#215775" }} />statewide</span></div>
          <LineChart history={history} />
        </div>
      )}
    </>
  );
}

function LineChart({ history }: { history: HistoryPoint[] }) {
  const pts = history.filter(p => p.state_yes_pct != null);
  const W = 420, H = 190, L = 34, R = 104, T = 12, B = 28;
  if (pts.length < 2)
    return <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Yes share of the vote on Prop 40 over time"><text x={W / 2} y={H / 2} textAnchor="middle" fill="#777" fontSize={12}>The chart appears after a few updates.</text></svg>;
  const vals = pts.map(p => p.state_yes_pct as number);
  const lo = Math.max(0, Math.floor(Math.min(...vals, 50) / 5) * 5 - 5), hi = Math.min(100, Math.ceil(Math.max(...vals, 50) / 5) * 5 + 5);
  const x = (i: number) => L + (i / (pts.length - 1)) * (W - L - R), y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks: number[] = []; for (let v = lo; v <= hi; v += 5) ticks.push(v);
  const lv = vals[vals.length - 1], li = pts.length - 1;
  const lab = (p: HistoryPoint) => (p.sos_time || "").replace(/^[A-Za-z]+ (\d+), \d+, /, "");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Yes share of the vote on Prop 40 over time">
      {ticks.map(v => <g key={v}>
        <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 50 ? "#20343f" : "#d6d6e5"} strokeDasharray={v === 50 ? "4 3" : undefined} />
        <text x={L - 5} y={y(v) + 4} textAnchor="end" fontSize={10} fill="#777">{v}%</text>
      </g>)}
      <polyline points={vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none" stroke="#215775" strokeWidth={2.2} strokeLinejoin="round" />
      <circle cx={x(li)} cy={y(lv)} r={3} fill="#215775" />
      <text x={x(li) + 7} y={y(lv) + 4} fontSize={11} fontWeight={700} fill="#215775">Statewide {lv.toFixed(1)}</text>
      <text x={L} y={H - 8} fontSize={10} fill="#777">{lab(pts[0])}</text>
      <text x={W - R} y={H - 8} textAnchor="end" fontSize={10} fill="#777">{lab(pts[li])}</text>
    </svg>
  );
}

/* ---- Measure RTM: decided by the combined vote of five counties; the tracker adds them up (D.rtm) ---- */
export function RtmBlock({ D }: { D: Results }) {
  const R = D.rtm, ala = rtmRace(D);
  if (!R && !ala) return null;
  return (
    <>
      <h2>Measure RTM</h2>
      <div className="imeta" style={{ marginTop: 8 }}>Regional transit sales tax · decided by the combined vote of five counties</div>
      {!R ? <RaceItem r={ala!} /> : (
        <div className="item" id="rtm">
          <div className="ititle">Five-county total</div>
          <div className="imeta"><b>{measureStatus(R.total, R.rule)}</b> · {R.counties_in} of 5 counties in the total</div>
          <Duel a={{ label: "Yes", votes: R.total.yes, pct: R.total.yes_pct }} b={{ label: "No", votes: R.total.no, pct: R.total.no_pct }} />
          <table className="t rtmt">
            <thead><tr>{["County", "Yes %", "Yes", "No", "Counted"].map(x => <th key={x}>{x}</th>)}</tr></thead>
            <tbody>{R.counties.map(c => {
              const have = c.status === "ok" || c.status === "manual", any = have && c.yes + c.no > 0;
              const counted = c.status === "manual" ? `typed in, ${c.note || ""}` : c.status === "waiting" ? "not available yet"
                : c.status === "error" ? "county site not readable" : c.precincts ? `${pct(c.precincts.pct, 0)} of precincts` : "";
              return <tr key={c.county} title={c.note || ""}><td>{c.county}</td><td className="n">{any ? pct(c.yes_pct) : "–"}</td>
                <td className="n">{have ? fmt(c.yes) : "–"}</td><td className="n">{have ? fmt(c.no) : "–"}</td><td className="st">{counted}</td></tr>;
            })}</tbody>
          </table>
          {!R.complete && <div className="note">Counties that can’t be read yet are left out of the total, so it is partial until all five are in.</div>}
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
      <h2>Governor</h2>
      {([["Statewide", g.state, "gov-state"], ["Alameda County", g.alameda, "gov-alameda"]] as const).map(([label, c, id]) => c && (
        <div className="item" id={id} key={id}>
          <div className="ititle">{label}</div>
          <div className="imeta">{progressText(c.precincts)}</div>
          {c.candidates.length === 2
            ? <Duel a={{ label: `${c.candidates[0].name} (${c.candidates[0].party})`, person: c.candidates[0].name, votes: c.candidates[0].votes, pct: c.candidates[0].pct }}
                    b={{ label: `${c.candidates[1].name} (${c.candidates[1].party})`, person: c.candidates[1].name, votes: c.candidates[1].votes, pct: c.candidates[1].pct }} />
            : <Ladder rows={c.candidates} total={c.total} />}
        </div>
      ))}
    </>
  );
}

/* ---- other statewide measures ---- */
export function OtherMeasures({ D }: { D: Results }) {
  const pri = ["41", "42"];
  const ms = D.state_measures.filter(m => m.number !== D.headline.number)
    .sort((a, b) => (Number(pri.includes(b.number)) - Number(pri.includes(a.number))) || (Number(a.number) - Number(b.number)));
  if (!ms.length) return null;
  return (
    <>
      <h2>Other statewide measures</h2>
      <div className="note" style={{ margin: "8px 0 0" }}>Props 41 and 42 were placed on the ballot by opponents of Prop 40.</div>
      <div className="mlist">{ms.map(m => {
        const s = m.state, any = s.yes + s.no > 0;
        return (
          <div className="mrow" key={m.number}>
            <div className="pn">Prop {m.number}</div>
            <div>
              <div className="mn">{m.name.replace(/\.\s*(Legislative|Initiative).*$/, "")}</div>
              <div className="bar mid"><i className="a" style={{ width: (any ? s.yes_pct : 0) + "%" }} /><i className="b" style={{ width: (any ? s.no_pct : 0) + "%" }} /></div>
              <div className="mv"><span>{any ? `Yes ${pct(s.yes_pct)} · No ${pct(s.no_pct)}` : "No votes yet"}</span>
                {m.alameda && m.alameda.yes + m.alameda.no > 0 && <span>Alameda: {pct(m.alameda.yes_pct)} yes</span>}</div>
            </div>
          </div>
        );
      })}</div>
    </>
  );
}
