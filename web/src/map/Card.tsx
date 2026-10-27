// What one race card shows. Positioning and transitions are CardLayer's job.
import { memo } from "react";
import { Tile } from "../components/Avatar";
import { type CardSpec, isClose, leadRace, shortWho } from "../lib/cards";
import { fmt } from "../lib/format";
import { headshotOf } from "../lib/headshots";

function LeadChip({ s }: { s: CardSpec }) {
  if (!s.who) return null;
  if (s.sub === "Unopposed") return <span className="pt chip">Unopp.</span>;
  if (s.who === "Tied") return <span className="pt chip">Tied</span>;
  return <span className="pt chip">+{s.margin.toFixed(1)}<small>pts</small></span>;
}

export function cardLabel(s: CardSpec) {
  if (s.more) return s.who || "More races";
  if (s.scope === "cluster") return `${s.title}: ${s.races?.length ?? 0} races. Zoom in.`;
  const zero = !s.who && s.sub !== "Unopposed";
  return `${s.tag}: ${zero ? "no votes yet" : s.who === "Tied" ? "tied" : `${s.who} leading by ${s.margin.toFixed(1)} points, ${fmt(s.votes)} votes`}`;
}

export const cardClass = (s: CardSpec, activeWard: string | null) => {
  if (s.more) return "card more";
  if (s.scope === "cluster") return "card cluster";
  const zero = !s.who && s.sub !== "Unopposed";
  return "card" + (isClose(s) ? " close" : "") + (zero ? " zero" : "") + (s.scope === "ward" && s.area[1] === activeWard ? " active" : "");
};

export const CardBody = memo(function CardBody({ s, moreCount }: { s: CardSpec; moreCount?: number }) {
  if (s.more) { const n = moreCount ?? s.moreCount ?? 0; return <>{`+${n} more race${n === 1 ? "" : "s"}`}</>; }

  if (s.scope === "cluster") {
    const races = s.races || [];
    const people = races.flatMap(r => (r.kind === "measure" ? [] : r.rows.map((p, i) => ({ name: p.name, lead: !!r.total && i === 0 }))));
    people.sort((a, b) => (Number(!!headshotOf(b.name)) - Number(!!headshotOf(a.name))) || (Number(b.lead) - Number(a.lead)));
    const shown = people.slice(0, 5), rest = people.length - shown.length;
    const close = races.filter(r => isClose(leadRace(r))).length;
    const counted = races.some(r => (r.kind === "measure" ? r.yes + r.no : r.total) > 0);
    const meta = `${races.length} races · ${people.length} candidates` + (counted ? (close ? ` · ${close} close` : "") : " · no votes yet");
    return (
      <>
        <span className="stackn">×{races.length}</span>
        <span className="ch"><b>{s.title}</b></span>
        <span className="cm">{meta}</span>
        <span className="row">{shown.map(p => <Tile key={p.name} name={p.name} lead={p.lead} />)}{rest > 0 && <span className="pt more">+{rest}</span>}</span>
      </>
    );
  }

  const zero = !s.who && s.sub !== "Unopposed";
  let tiles;
  if (s.measure) {
    const m = s.measure, any = m.yes + m.no > 0;
    tiles = <>
      <span className={"pt yn yes" + (m.leader === "yes" ? " lead" : "")}><b>Yes</b>{any ? Math.round(m.yes_pct) + "%" : "–"}</span>
      <span className={"pt yn no" + (m.leader === "no" ? " lead" : "")}><b>No</b>{any ? Math.round(m.no_pct) + "%" : "–"}</span>
    </>;
  } else {
    const ps = s.people || [];
    tiles = <>{ps.slice(0, 4).map((p, i) => <Tile key={p.name} name={p.name} lead={i === 0 && !!s.who && s.who !== "Tied"} />)}{ps.length > 4 && <span className="pt more">+{ps.length - 4}</span>}</>;
  }
  const n = s.people ? s.people.length : 0;
  const meta = zero ? `${s.meta} · ${n ? n + " candidates · " : ""}no votes yet`
    : s.sub === "Unopposed" ? `${s.meta} · ${shortWho(s.who)} unopposed`
    : s.who === "Tied" ? `${s.meta} · tied`
    : `${s.meta} · ${shortWho(s.who)} ahead by ${fmt(s.votes)}${s.sub ? " · " + s.sub : ""}`;
  return (
    <>
      <span className="ch"><b>{s.title}</b></span>
      <span className="cm">{meta}</span>
      <span className="row">{tiles}{!zero && <LeadChip s={s} />}</span>
    </>
  );
});
