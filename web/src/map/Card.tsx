// What one race card shows. Positioning and transitions are CardLayer's job.
import { memo } from "react";
import { Tile } from "../components/Avatar";
import { type CardSpec, isClose, leadRace, shortWho } from "../lib/cards";
import { callText, fmt } from "../lib/format";
import { headshotOf } from "../lib/headshots";

function LeadChip({ s }: { s: CardSpec }) {
  if (s.call) return <span className="pt chip won" title={s.call.how === "desk" ? "Called" : "Decided: the trailing side can’t catch up"}>✓<small>{s.measure ? (s.call.winners[0] === "Yes" ? "Passes" : "Fails") : "Called"}</small></span>;
  if (!s.who) return null;
  if (s.sub === "Unopposed") return <span className="pt chip">Unopp.</span>;
  if (s.who === "Tied") return <span className="pt chip">Tied</span>;
  return <span className="pt chip">+{s.margin.toFixed(1)}<small>pts</small></span>;
}

export function cardLabel(s: CardSpec) {
  if (s.more) return s.who || "More races";
  if (s.scope === "cluster") return `${s.title}: ${s.races?.length ?? 0} races. Zoom in.`;
  const zero = !s.who && s.sub !== "Unopposed";
  if (s.call) return `${s.tag}: ${callText(s.call, !!s.measure)}`;
  return `${s.tag}: ${zero ? "no votes yet" : s.who === "Tied" ? "tied" : `${s.who} leading by ${s.margin.toFixed(1)} points, ${fmt(s.votes)} votes`}`;
}

export const cardClass = (s: CardSpec, activeWard: string | null) => {
  if (s.more) return "card more";
  if (s.scope === "cluster") return "card cluster";
  const zero = !s.who && s.sub !== "Unopposed";
  return "card" + (s.scope === "ward" ? " district" : "") + (s.call ? " called" : isClose(s) ? " close" : "") + (zero ? " zero" : "") + (s.scope === "ward" && s.area[1] === activeWard ? " active" : "");
};

export const CardBody = memo(function CardBody({ s, moreCount }: { s: CardSpec; moreCount?: number }) {
  if (s.more) { const n = moreCount ?? s.moreCount ?? 0; return <>{`+${n} more race${n === 1 ? "" : "s"}`}</>; }

  if (s.scope === "cluster") {
    const races = s.races || [];
    const people = races.flatMap(r => (r.kind === "measure" ? [] : r.rows.map((p, i) => ({ name: p.name, lead: r.call ? r.call.winners.includes(p.name) : !!r.total && i === 0, won: !!r.call?.winners.includes(p.name) }))));
    people.sort((a, b) => (Number(!!headshotOf(b.name)) - Number(!!headshotOf(a.name))) || (Number(b.lead) - Number(a.lead)));
    const shown = people.slice(0, 5), rest = people.length - shown.length;
    const close = races.filter(r => isClose(leadRace(r))).length;
    const counted = races.some(r => (r.kind === "measure" ? r.yes + r.no : r.total) > 0);
    const called = races.filter(r => r.call).length;
    const meta = `${races.length} races` + (called ? ` · ${called} called` : "") + (counted && close ? ` · ${close} close` : "");
    return (
      <>
        <span className="stackn">×{races.length}</span>
        <span className="ch"><b>{s.title}</b></span>
        <span className="cm">{meta}</span>
        <span className="row">{shown.map(p => <Tile key={p.name} name={p.name} lead={p.lead} won={p.won} />)}{rest > 0 && <span className="pt more">+{rest}</span>}</span>
      </>
    );
  }

  const zero = !s.who && s.sub !== "Unopposed";
  if (s.pin && !s.measure) {   // council districts sit side by side on the map: just the leader (or winner) and the margin
    const p = s.call ? (s.people || []).find(x => s.call!.winners.includes(x.name)) : (s.people || [])[0];
    return (
      <>
        <span className="ch"><b>{s.title}</b></span>
        <span className="row">
          {zero ? <span className="cm">{(s.people || []).length} candidates</span>
            : <>{p && <Tile name={p.name} lead won={!!s.call} />}<span className="who">{shortWho(p?.name ?? s.who)}</span><LeadChip s={s} /></>}
        </span>
      </>
    );
  }
  let tiles;
  if (s.measure) {
    const m = s.measure, any = m.yes + m.no > 0;
    tiles = <>
      <span className={"pt yn yes" + ((s.call ? s.call.winners[0] === "Yes" : m.leader === "yes") ? " lead" : "")}><b>Yes</b>{any ? Math.round(m.yes_pct) + "%" : "–"}</span>
      <span className={"pt yn no" + ((s.call ? s.call.winners[0] === "No" : m.leader === "no") ? " lead" : "")}><b>No</b>{any ? Math.round(m.no_pct) + "%" : "–"}</span>
    </>;
  } else {
    const ps = s.people || [], won = new Set(s.call?.winners);
    tiles = <>{ps.slice(0, 4).map((p, i) => <Tile key={p.name} name={p.name} won={won.has(p.name)} lead={s.call ? won.has(p.name) : i === 0 && !!s.who && s.who !== "Tied"} />)}{ps.length > 4 && <span className="pt more">+{ps.length - 4}</span>}</>;
  }
  const meta = s.call ? `${s.meta} · ${callText(s.call, !!s.measure, shortWho)}`
    : zero ? s.meta
    : s.sub === "Unopposed" ? `${s.meta} · ${shortWho(s.who)} unopposed`
    : s.who === "Tied" ? `${s.meta} · tied`
    : `${s.meta} · ${shortWho(s.who)} by ${fmt(s.votes)}${s.sub ? " · " + s.sub : ""}`;
  return (
    <>
      <span className="ch"><b>{s.title}</b></span>
      <span className="cm">{meta}</span>
      <span className="row">{tiles}{!zero && <LeadChip s={s} />}</span>
    </>
  );
});
