// Every race on a Berkeley ballot, in a row along the bottom of the map. A vertical scroll (mouse wheel or trackpad)
// over the row moves it sideways instead of zooming the map or scrolling the page. Clicking a card selects that race.
import { memo, useEffect, useRef } from "react";
import { DISTRICT_COLORS } from "../config";
import type { CardSpec } from "../lib/cards";
import { CardBody, cardClass, cardLabel } from "../map/Card";
import { S } from "../strings";

export interface RaceStripProps {
  cards: CardSpec[];
  selected: string | null;
  activeWard: string | null;
  rightInset: number;
  show: boolean;
  onCard: (s: CardSpec) => void;
  onHeight: (px: number) => void;   // so map cards and the camera keep clear of the strip
}

export const RaceStrip = memo(function RaceStrip({ cards, selected, activeWard, rightInset, show, onCard, onHeight }: RaceStripProps) {
  const row = useRef<HTMLDivElement>(null), box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();   // never zoom the map or scroll the page from here
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
      const d = (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * unit;
      el.scrollLeft += d;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // keep the selected race in view (selecting it on the map, or the level opening on it)
  useEffect(() => {
    const el = row.current, item = selected ? el?.querySelector<HTMLElement>(`[data-sel="${CSS.escape(selected)}"]`) : null;
    if (!el || !item) return;
    const l = item.offsetLeft - 12, r = item.offsetLeft + item.offsetWidth + 12;
    if (l < el.scrollLeft) el.scrollTo({ left: l, behavior: "smooth" });
    else if (r > el.scrollLeft + el.clientWidth) el.scrollTo({ left: r - el.clientWidth, behavior: "smooth" });
  }, [selected, show]);

  return (
    <div ref={box} className={"strip" + (show ? " on" : "")} style={{ right: rightInset }} aria-hidden={!show || undefined}>
      <div className="striprow" ref={row} role="list" aria-label={S.stripLabel}>
        {cards.map(s => (
          <div role="listitem" key={s.key} className="stripitem">
            <button type="button" data-sel={s.focus ?? undefined} tabIndex={show ? 0 : -1} aria-label={cardLabel(s)} aria-pressed={s.focus === selected}
              className={cardClass(s, activeWard) + (s.focus === selected ? " sel" : "")}
              style={{ ["--dc" as any]: s.scope === "ward" ? DISTRICT_COLORS[s.area[1]]?.fill : undefined }}
              onClick={() => onCard(s)}>
              <CardBody s={s} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
});
