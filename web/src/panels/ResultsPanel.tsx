// The results card. When the selected race changes, the old detail slides out while the new one slides in: up when you
// zoom in (city is "deeper"), down when you zoom out, a cross-fade between races at the same level. New numbers for the
// same race update in place, keeping the scroll spot.
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CONFIG, RANK } from "../config";
import type { View } from "../types";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Detail, type DetailProps } from "./Detail";

type Shown = { view: View; sel: string; key: string; dir: "in" | "out" | "none" };
const keyOf = (v: View, sel: string) => `${v.level}:${v.id}|${sel}`;

export const ResultsPanel = forwardRef<HTMLElement, DetailProps & { view: View }>(
  function ResultsPanel({ view, sel, ...rest }, ref) {
    const [cur, setCur] = useState<Shown>({ view, sel, key: keyOf(view, sel), dir: "none" });
    const [leaving, setLeaving] = useState<{ shown: Shown; top: number } | null>(null);
    const scroller = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
      const k = keyOf(view, sel);
      if (k === cur.key) return;
      if (sel === cur.sel) { setCur({ ...cur, view, key: k }); return; }   // same race, another level: nothing to animate
      const dir = RANK[view.level] < RANK[cur.view.level] ? "in" : RANK[view.level] > RANK[cur.view.level] ? "out" : "none";
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      setLeaving(reduce ? null : { shown: { ...cur, dir }, top: scroller.current?.scrollTop ?? 0 });
      setCur({ view, sel, key: k, dir });
      if (scroller.current) scroller.current.scrollTop = 0;
    }, [view, sel]);   // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
      if (!leaving) return;
      const t = window.setTimeout(() => setLeaving(null), CONFIG.transitionMs + 60);
      return () => window.clearTimeout(t);
    }, [leaving]);

    return (
      <aside className="results" aria-label="Race details" ref={ref}>
        <div className="rscroll" ref={scroller}>
          <div className={`pane enter-${cur.dir}`} key={cur.sel} aria-live="polite">
            <ErrorBoundary label="these results" resetKey={rest.D.generated_at}>
              <Detail {...rest} sel={cur.sel} />
            </ErrorBoundary>
          </div>
        </div>
        {leaving && (
          <div className={`pane ghost leave-${leaving.shown.dir}`} aria-hidden="true">
            <div style={{ transform: `translateY(${-leaving.top}px)` }}>
              <ErrorBoundary label="these results"><Detail {...rest} sel={leaving.shown.sel} /></ErrorBoundary>
            </div>
          </div>
        )}
      </aside>
    );
  });
