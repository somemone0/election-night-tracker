// What one race card shows. Positioning and transitions are CardLayer's job.
import { memo } from "react";
import { Tile } from "../components/Avatar";
import { type CardSpec, isClose, leadRace, shortWho } from "../lib/cards";
import { callText, fmt } from "../lib/format";
import { headshotOf } from "../lib/headshots";
import { S } from "../strings";

// the state of the race in a word or two, as text: "✓ Called", "+1.5", "Tied"
function LeadChip({ s }: { s: CardSpec }) {
  if (s.call) return <span className="lt won" title={s.call.how === "desk" ? S.called : S.decidedTip}>✓ {s.measure ? (s.call.winners[0] === "Yes" ? S.passes : S.fails) : S.called}</span>;
  if (!s.who) return null;
  if (s.sub === S.unopposed) return <span className="lt">{S.unopposed}</span>;
  if (s.who === S.tied) return <span className="lt">{S.tied}</span>;
  return <span className="lt" title={S.leadsBy(s.margin.toFixed(1))}>+{s.margin.toFixed(1)}</span>;
}

export function cardLabel(s: CardSpec) {
  if (s.more) return s.who || S.moreRaces;
  if (s.scope === "cluster") return S.clusterLabel(s.title, s.races?.length ?? 0);
  const zero = !s.who && s.sub !== S.unopposed;
  if (s.call) return `${s.tag}: ${callText(s.call, !!s.measure)}`;
  return `${s.tag}: ${zero ? S.noVotesYet : s.who === S.tied ? S.tiedLower : S.leadingBy(s.who, s.margin.toFixed(1), fmt(s.votes))}`;
}

export const cardClass = (s: CardSpec, activeWard: string | null) => {
  if (s.more) return "card more";
  if (s.scope === "cluster") return "card cluster";
  const zero = !s.who && s.sub !== S.unopposed;
  return "card" + (s.scope === "ward" ? " district" : "") + (s.call ? " called" : isClose(s) ? " close" : "") + (zero ? " zero" : "") + (s.scope === "ward" && s.area[1] === activeWard ? " active" : "");
};

export const CardBody = memo(function CardBody({ s, moreCount }: { s: CardSpec; moreCount?: number }) {
  if (s.more) { const n = moreCount ?? s.moreCount ?? 0; return <>{S.moreRacesN(n)}</>; }

  if (s.scope === "cluster") {
    const races = s.races || [];
    const people = races.flatMap(r => (r.kind === "measure" ? [] : r.rows.map((p, i) => ({ name: p.name, lead: r.call ? r.call.winners.includes(p.name) : !!r.total && i === 0, won: !!r.call?.winners.includes(p.name) }))));
    people.sort((a, b) => (Number(!!headshotOf(b.name)) - Number(!!headshotOf(a.name))) || (Number(b.lead) - Number(a.lead)));
    const shown = people.slice(0, 5), rest = people.length - shown.length;
    const close = races.filter(r => isClose(leadRace(r))).length;
    const counted = races.some(r => (r.kind === "measure" ? r.yes + r.no : r.total) > 0);
    const called = races.filter(r => r.call).length;
    const meta = S.races(races.length) + (called ? S.calledN(called) : "") + (counted && close ? S.closeN(close) : "");
    return (
      <>
        <span className="ch"><b>{s.title}</b></span>
        <span className="cm">{meta}</span>
        <span className="row">{shown.map(p => <Tile key={p.name} name={p.name} lead={p.lead} won={p.won} />)}{rest > 0 && <span className="pt more">+{rest}</span>}</span>
      </>
    );
  }

  const zero = !s.who && s.sub !== S.unopposed;
  if (s.pin && !s.measure) {   // council districts sit side by side on the map: just the leader (or winner) and the margin
    const p = s.call ? (s.people || []).find(x => s.call!.winners.includes(x.name)) : (s.people || [])[0];
    return (
      <>
        <span className="ch"><b>{s.title}</b></span>
        <span className="row">
          {zero ? <span className="cm">{S.candidates((s.people || []).length)}</span>
            : <>{p && <Tile name={p.name} lead won={!!s.call} />}<span className="who">{shortWho(p?.name ?? s.who)}</span><LeadChip s={s} /></>}
        </span>
      </>
    );
  }
  let tiles;
  if (s.measure) {
    const m = s.measure, any = m.yes + m.no > 0;
    const lead = (side: "yes" | "no") => (s.call ? s.call.winners[0].toLowerCase() === side : m.leader === side);
    tiles = <span className="yn">
      <span className={lead("yes") ? "lead" : undefined}>{S.yes} {any ? Math.round(m.yes_pct) + "%" : S.none}</span>
      <span className={lead("no") ? "lead" : undefined}>{S.no} {any ? Math.round(m.no_pct) + "%" : S.none}</span>
    </span>;
  } else {
    const ps = s.people || [], won = new Set(s.call?.winners);
    tiles = <>{ps.slice(0, 4).map((p, i) => <Tile key={p.name} name={p.name} won={won.has(p.name)} lead={s.call ? won.has(p.name) : i === 0 && !!s.who && s.who !== S.tied} />)}{ps.length > 4 && <span className="pt more">+{ps.length - 4}</span>}</>;
  }
  const meta = s.call ? `${s.meta} · ${callText(s.call, !!s.measure, shortWho)}`
    : zero ? s.meta
    : s.sub === S.unopposed ? `${s.meta} · ${S.unopposedLower(shortWho(s.who))}`
    : s.who === S.tied ? `${s.meta} · ${S.tiedLower}`
    : `${s.meta} · ${S.byVotes(shortWho(s.who), fmt(s.votes))}${s.sub ? " · " + s.sub : ""}`;
  return (
    <>
      <span className="ch"><b>{s.title}</b></span>
      <span className="cm">{meta}</span>
      <span className="row">{tiles}{!zero && <LeadChip s={s} />}</span>
    </>
  );
});
