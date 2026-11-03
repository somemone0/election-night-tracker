// Compact race navigation beside the map, independent of map cards and results.
import { memo, useEffect, useRef, useState } from "react";
import { DISTRICT_COLORS } from "../config";
import { raceGroups } from "../lib/raceGroups";
import type { CardSpec } from "../lib/cards";
import { pct } from "../lib/format";
import { S } from "../strings";
import { Avatar } from "./Avatar";

interface Props {
  cards: CardSpec[];
  selected: string | null;
  rightInset: number;
  onCard: (s: CardSpec) => void;
}

function percentage(card: CardSpec) {
  if (card.measure) {
    const m = card.measure;
    if (!(m.yes + m.no)) return S.none;
    const choice = m.leader === "no" ? S.no : S.yes;
    return <>{m.leader === "tied" ? choice : <strong>{choice}</strong>} {pct(m.leader === "no" ? m.no_pct : m.yes_pct)}</>;
  }
  const leader = card.people?.[0];
  return leader && card.people?.some(person => person.votes > 0) ? pct(leader.pct) : S.none;
}

export const RaceMenu = memo(function RaceMenu({ cards, selected, rightInset, onCard }: Props) {
  const [open, setOpen] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = list.current;
    const item = selected ? el?.querySelector<HTMLElement>(`[data-sel="${CSS.escape(selected)}"]`) : null;
    if (!el || !item) return;
    const top = item.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + item.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + item.offsetHeight - el.clientHeight;
  }, [selected, open]);

  if (!cards.length) return null;
  return (
    <nav className={"race-menu" + (open ? " open" : "")} style={{ right: rightInset + 12 }} aria-label={S.stripLabel}>
      <button className="race-menu-toggle" type="button" aria-expanded={open} aria-controls="race-menu-list" onClick={() => setOpen(value => !value)}>
        <span>{S.raceMenuTitle}</span><span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="race-menu-list" id="race-menu-list" ref={list}>
        {raceGroups(cards).map(group => <section key={group.key}>
          <h2>{group.title}</h2>
          {group.cards.map(card => <button type="button" key={card.key} data-sel={card.focus ?? undefined}
            className="race-menu-item" aria-pressed={card.focus === selected} onClick={() => onCard(card)}
            style={card.scope === "ward" ? { borderLeftColor: DISTRICT_COLORS[card.area[1]]?.fill } : undefined}>
            <span className="race-menu-name">{card.title}</span>
            <span className={"race-menu-percentage" + (card.measure ? " measure" : "")}>
              {!card.measure && card.people?.[0] && card.people.some(person => person.votes > 0) &&
                <span title={card.people[0].name} aria-label={card.people[0].name}><Avatar name={card.people[0].name} size={18} /></span>}
              {percentage(card)}
            </span>
          </button>)}
        </section>)}
      </div>}
    </nav>
  );
});
