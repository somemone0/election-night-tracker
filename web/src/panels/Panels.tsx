// What the results card shows at each level.
import { CONFIG } from "../config";
import { GovernorBlock, OtherMeasures, Prop40Block, RaceItem, RtmBlock } from "../components/blocks";
import { rtmRace } from "../lib/cards";
import { anchor, featureAt, featureById } from "../lib/geo";
import { fmt, pct } from "../lib/format";
import type { Geo, HistoryPoint, Level, Results, View } from "../types";

export interface PanelProps { D: Results; history: HistoryPoint[]; geo: Geo; view: View; go: (level: Level, id: string) => void }

function Header({ kicker, title, crumbs, go }: { kicker: string; title: string; crumbs: [string, Level, string][]; go: PanelProps["go"] }) {
  return (
    <div className="rhead">
      <div className="kicker">{kicker}</div>
      <h1>{title}</h1>
      {crumbs.length > 0 && <div className="crumbs">{crumbs.map(([label, level, id], i) => (
        <span key={label}>{i > 0 && <i>›</i>}<button type="button" onClick={() => go(level, id)}>{label}</button></span>
      ))}</div>}
    </div>
  );
}

function CityPanel({ D, geo, view, go }: PanelProps) {
  const name = view.id, f = featureById(geo, "city", name);
  const cd = f ? featureAt(geo, "congress", ...anchor(f)) : null;
  const rs = D.races.filter(r => r.group === "city" && r.city === name);
  const meas = rs.filter(r => r.kind === "measure"), cands = rs.filter(r => r.kind !== "measure");
  return (
    <>
      <Header kicker="City" title={name} go={go} crumbs={[...(cd ? [[`Congressional District ${cd.properties.id}`, "congress", String(cd.properties.id)] as [string, Level, string]] : []), ["Alameda County", "county", "alameda"], ["California", "state", "CA"]]} />
      {meas.length > 0 && <><h2>Ballot measures</h2>{meas.map(r => <RaceItem key={r.id} r={r} />)}</>}
      {cands.length > 0 && <><h2>Races</h2>{cands.map(r => <RaceItem key={r.id} r={r} />)}</>}
      {!rs.length && <p className="empty">The county’s results page has no {name} city contests listed yet.</p>}
      <RtmBlock D={D} />
      <Prop40Block D={D} history={[]} full={false} />
      <div className="note">Prop 40 is shown as the statewide total.</div>
    </>
  );
}

function CongressPanel({ D, geo, view, go }: PanelProps) {
  const id = view.id;
  const rs = D.races.filter(r => r.group === "congress" && String(r.cd) === id);
  const cities = geo.cityAll.features.filter(c => featureAt(geo, "congress", ...anchor(c))?.properties.id === id);
  return (
    <>
      <Header kicker="Congress" title={`District ${id}`} go={go} crumbs={[["Alameda County", "county", "alameda"], ["California", "state", "CA"]]} />
      <h2>U.S. House</h2>
      {rs.length ? rs.map(r => <RaceItem key={r.id} r={r} />) : <p className="empty">This race has not appeared on the county’s results page yet.</p>}
      {cities.length > 0 && <div className="crumbs" style={{ marginTop: 10 }}>Includes parts of:&nbsp;{cities.map((c, i) => (
        <span key={c.properties.id}>{i > 0 && ", "}{CONFIG.localCities.includes(c.properties.name)
          ? <button type="button" onClick={() => go("city", c.properties.id)}>{c.properties.name}</button> : c.properties.name}</span>
      ))}</div>}
      <RtmBlock D={D} />
      <Prop40Block D={D} history={[]} full={false} />
    </>
  );
}

function CountyPanel({ D, go }: PanelProps) {
  const turn = D.races.find(r => r.group === "turnout" && /^Regular/.test(r.title));
  const total = turn && turn.kind === "candidate" ? turn.rows.find(r => /Total Ballots Cast/.test(r.name)) : undefined;
  const rtm = rtmRace(D), hasGov = !!D.contests?.governor;
  const rs = D.races.filter(r => r.group === "county" && r !== rtm && !(hasGov && r.title === "Governor"));
  const meas = rs.filter(r => r.kind === "measure"), cands = rs.filter(r => r.kind !== "measure");
  return (
    <>
      <Header kicker="County" title="Alameda County" go={go} crumbs={[["California", "state", "CA"]]} />
      {total && <p className="lede">{total.votes ? `${fmt(total.votes)} ballots counted so far, ${pct(total.pct)} of registered voters. Counting continues for days.` : "No ballots counted yet."}</p>}
      <RtmBlock D={D} />
      <GovernorBlock D={D} />
      {cands.length > 0 && <><h2>Countywide races</h2>{cands.map(r => <RaceItem key={r.id} r={r} />)}</>}
      {meas.length > 0 && <><h2>Countywide measures</h2>{meas.map(r => <RaceItem key={r.id} r={r} />)}</>}
    </>
  );
}

function StatePanel({ D, history, go }: PanelProps) {
  return (
    <>
      <Header kicker="State" title="California" go={go} crumbs={[]} />
      <Prop40Block D={D} history={history} full />
      <GovernorBlock D={D} />
      <OtherMeasures D={D} />
    </>
  );
}

export function Panel(p: PanelProps) {
  const body = p.view.level === "city" ? <CityPanel {...p} /> : p.view.level === "congress" ? <CongressPanel {...p} /> : p.view.level === "county" ? <CountyPanel {...p} /> : <StatePanel {...p} />;
  const m = p.D.meta;
  return (
    <>
      {body}
      <div className="foot">
        Unofficial results. “Leading” is not a race call. Counts change as ballots are processed. Sources:{" "}
        <a href="https://www.sos.ca.gov/elections/prior-elections/statewide-election-results" rel="noopener">California Secretary of State</a> (statewide and county measures, governor),{" "}
        <a href="https://acvote.alamedacountyca.gov/" rel="noopener">Alameda County Registrar of Voters</a> (county, district and city contests) and the five counties’ registrars (Measure RTM).{" "}
        {m.sos_state?.reporting_time ? `State feed: ${m.sos_state.reporting_time.replace(/\.$/, "")}. ` : ""}{m.alameda?.updated ? `County page: ${m.alameda.updated}.` : ""}
      </div>
    </>
  );
}
