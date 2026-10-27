// Race cards over the map.
//
// Stability: card positions are written straight to the DOM on every map "move" event (the same frame MapLibre draws),
// so cards never lag behind the map or re-render React while you zoom. Collision layout runs only once the map stops,
// and cards keep their spot while it moves, so nothing flashes.
//
// Transitions between levels: cards that stay keep their element; new ones fade in and old ones fade out. When a
// city's stacked "cluster" card gives way to its races (zooming in), the races fly out from the cluster's spot; zooming
// out, they fly back into it while the cluster fades in.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { CONFIG } from "../config";
import type { CardSpec } from "../lib/cards";
import { layoutCards, type Offset } from "../lib/layout";
import { CardBody, cardClass, cardLabel } from "./Card";

// held: arrived while the camera was flying; kept hidden until it lands and the card has a laid-out spot
interface Entry { spec: CardSpec; phase: "in" | "live" | "out"; fly: [number, number] | null; at: number; held?: boolean }

export interface CardLayerProps {
  map: MlMap;
  cards: CardSpec[];
  rightInset: number;             // px of the map covered by the results panel
  activeWard: string | null;
  onCard: (s: CardSpec) => void;
}

function nextEntries(prev: Entry[], cards: CardSpec[], now: number, moving: boolean): Entry[] {
  const want = new Map(cards.map(c => [c.key, c]));
  const live = new Map(prev.filter(e => e.phase !== "out").map(e => [e.spec.key, e]));
  const out: Entry[] = [];
  for (const c of cards) {
    const was = live.get(c.key);
    if (was) { out.push(was.spec === c ? was : { ...was, spec: c }); continue; }
    const parent = c.parent ? live.get(c.parent) : undefined;      // zooming in: fly out of the cluster
    out.push({ spec: c, phase: "in", fly: parent ? parent.spec.ll : null, at: now, held: moving });
  }
  for (const e of prev) {
    if (want.has(e.spec.key)) continue;
    if (e.phase === "out") { out.push(e); continue; }
    const parent = e.spec.parent ? want.get(e.spec.parent) : undefined;   // zooming out: fly into the cluster
    out.push({ ...e, phase: "out", fly: parent ? parent.ll : null, at: now });
  }
  return out;
}

const sameOffsets = (a: Map<string, Offset | null>, b: Map<string, Offset | null>) =>
  a.size === b.size && [...a].every(([k, v]) => { const w = b.get(k); return v === w || (!!v && !!w && v.dx === w.dx && v.lift === w.lift && v.below === w.below); });

export function CardLayer({ map, cards, rightInset, activeWard, onCard }: CardLayerProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [offsets, setOffsets] = useState<Map<string, Offset | null>>(new Map());
  const [moreCount, setMoreCount] = useState<number | undefined>(undefined);
  const pos = useRef(new Map<string, HTMLDivElement>());     // positioned wrapper per card
  const body = useRef(new Map<string, HTMLButtonElement>()); // the card itself, for its size
  const lls = useRef(new Map<string, [number, number]>());
  const moving = useRef(false);
  const offsetsRef = useRef(offsets); offsetsRef.current = offsets;
  const entriesRef = useRef(entries); entriesRef.current = entries;
  const insetRef = useRef(rightInset); insetRef.current = rightInset;

  // which cards exist (with enter/exit phases)
  useEffect(() => { setEntries(prev => nextEntries(prev, cards, performance.now(), moving.current)); }, [cards]);
  useEffect(() => {   // retire finished transitions
    if (!entries.some(e => e.phase !== "live")) return;
    const t = window.setTimeout(() => {
      const now = performance.now();
      setEntries(prev => prev.filter(e => !(e.phase === "out" && now - e.at >= CONFIG.transitionMs))
        .map(e => (e.held && now - e.at > 2500 ? { ...e, held: false, at: now }        // never stay hidden if the camera never reports landing
          : e.phase === "in" && !e.held && now - e.at >= CONFIG.transitionMs ? { ...e, phase: "live" as const } : e)));
    }, entries.some(e => e.held) ? 600 : CONFIG.transitionMs + 40);
    return () => window.clearTimeout(t);
  }, [entries]);

  // follow the map, every frame it draws
  const reposition = useCallback(() => {
    for (const [key, el] of pos.current) {
      const ll = lls.current.get(key);
      if (!ll) continue;
      const p = map.project(ll);
      el.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
    }
  }, [map]);

  // place cards so they do not overlap; only while the map is still
  const relayout = useCallback(() => {
    if (moving.current) return;
    const size = map.getContainer().getBoundingClientRect();
    const items = entriesRef.current.filter(e => e.phase !== "out").map(e => {
      const p = map.project(e.spec.ll), el = body.current.get(e.spec.key);
      return { key: e.spec.key, x: p.x, y: p.y, w: el?.offsetWidth || 200, h: el?.offsetHeight || 80, prio: e.spec.prio, more: e.spec.more, moreCount: e.spec.moreCount, scope: e.spec.scope };
    });
    const { offsets: next, moreCount: n } = layoutCards(items, {
      top: 10, left: 4, right: size.width - insetRef.current - 4, bottom: size.height - 8,
      avoid: [{ x: 0, y: 0, w: 66, h: 110 }],   // zoom buttons
    }, offsetsRef.current);
    if (!sameOffsets(next, offsetsRef.current)) setOffsets(next);
    setMoreCount(n || undefined);
  }, [map]);

  useEffect(() => {
    const onMove = () => reposition();
    const onStart = () => { moving.current = true; };
    const onEnd = () => {
      moving.current = false;
      relayout();
      const now = performance.now();   // cards that arrived mid-flight: now that they have a spot, bring them in
      setEntries(prev => (prev.some(e => e.held) ? prev.map(e => (e.held ? { ...e, held: false, at: now } : e)) : prev));
    };
    map.on("move", onMove); map.on("movestart", onStart); map.on("moveend", onEnd); map.on("resize", onEnd);
    return () => { map.off("move", onMove); map.off("movestart", onStart); map.off("moveend", onEnd); map.off("resize", onEnd); };
  }, [map, reposition, relayout]);

  useLayoutEffect(() => {
    // React calls ref callbacks with null on every re-render, so card coordinates are set in the ref and pruned here
    for (const k of lls.current.keys()) if (!pos.current.has(k)) lls.current.delete(k);
    reposition(); relayout();
  }, [entries, rightInset, reposition, relayout]);

  return (
    <div className="cards" aria-label="Races on the map">
      {entries.map(e => {
        const s = e.spec, o = offsets.get(s.key);
        let fx = 0, fy = 0;
        if (e.fly && e.phase !== "live") {
          const a = map.project(s.ll), b = map.project(e.fly);
          fx = Math.round(b.x - a.x); fy = Math.round(b.y - a.y);
        }
        const fits = e.phase === "out" || o !== null;     // undefined = not laid out yet: show at the default spot
        const stacked = !!o && (o.below || o.lift > 0 || o.dx !== 0);
        return (
          <div key={s.key} className={`cardpos ${e.phase}${e.held ? " held" : ""}`} data-fly={e.fly ? "1" : undefined}
            style={{ zIndex: 1000 - Math.round(s.prio * 10), ["--fx" as any]: fx + "px", ["--fy" as any]: fy + "px", ["--t" as any]: CONFIG.transitionMs + "ms" }}
            ref={el => { if (el) { pos.current.set(s.key, el); lls.current.set(s.key, s.ll); } else pos.current.delete(s.key); }}>
            <div className="fly">
              <button type="button" tabIndex={e.phase === "out" || !fits ? -1 : 0} aria-label={cardLabel(s)} aria-hidden={e.phase === "out" || !fits || undefined}
                className={cardClass(s, activeWard) + (o?.below ? " below" : "") + (stacked ? " stacked" : "") + (fits ? "" : " nofit")}
                style={{ ["--dx" as any]: (o?.dx ?? 0) + "px", ["--lift" as any]: (o?.lift ?? 0) + "px" }}
                ref={el => { if (el) body.current.set(s.key, el); else body.current.delete(s.key); }}
                onClick={ev => { ev.stopPropagation(); if (e.phase !== "out") onCard(s); }}>
                <CardBody s={s} moreCount={s.more ? moreCount : undefined} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
