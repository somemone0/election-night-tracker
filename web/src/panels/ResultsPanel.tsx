// The results card. When the view changes, the old panel slides out while the new one slides in: up when you zoom in
// (city is "deeper"), down when you zoom out. New numbers for the same view update in place, keeping the scroll spot.
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CONFIG, RANK } from "../config";
import type { View } from "../types";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Panel, type PanelProps } from "./Panels";

type Shown = { view: View; key: string; dir: "in" | "out" | "none" };
const keyOf = (v: View) => `${v.level}:${v.id}`;

export const ResultsPanel = forwardRef<HTMLElement, Omit<PanelProps, "view"> & { view: View; focus: { id: string; seq: number } | null }>(
  function ResultsPanel({ view, focus, ...rest }, ref) {
    const [cur, setCur] = useState<Shown>({ view, key: keyOf(view), dir: "none" });
    const [leaving, setLeaving] = useState<{ shown: Shown; top: number } | null>(null);
    const scroller = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
      const k = keyOf(view);
      if (k === cur.key) return;
      const dir = RANK[view.level] < RANK[cur.view.level] ? "in" : RANK[view.level] > RANK[cur.view.level] ? "out" : "none";
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      setLeaving(reduce ? null : { shown: { ...cur, dir }, top: scroller.current?.scrollTop ?? 0 });
      setCur({ view, key: k, dir });
      if (scroller.current) scroller.current.scrollTop = 0;
    }, [view]);   // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
      if (!leaving) return;
      const t = window.setTimeout(() => setLeaving(null), CONFIG.transitionMs + 60);
      return () => window.clearTimeout(t);
    }, [leaving]);

    // scroll a race into view (card clicks)
    useEffect(() => {
      if (!focus) return;
      const t = window.setTimeout(() => {
        const n = document.getElementById(focus.id);
        if (!n) return;
        n.scrollIntoView({ block: "center", behavior: "smooth" });
        n.classList.remove("flash"); void n.offsetWidth; n.classList.add("flash");
      }, 90);
      return () => window.clearTimeout(t);
    }, [focus?.seq]);   // eslint-disable-line react-hooks/exhaustive-deps

    return (
      <aside className="results" aria-label="Results" ref={ref}>
        <div className="rscroll" ref={scroller}>
          <div className={`pane enter-${cur.dir}`} key={cur.key} aria-live="polite">
            <ErrorBoundary label="these results" resetKey={rest.D.generated_at}>
              <Panel {...rest} view={cur.view} />
            </ErrorBoundary>
          </div>
        </div>
        {leaving && (
          <div className={`pane ghost leave-${leaving.shown.dir}`} aria-hidden="true">
            <div style={{ transform: `translateY(${-leaving.top}px)` }}>
              <ErrorBoundary label="these results"><Panel {...rest} view={leaving.shown.view} /></ErrorBoundary>
            </div>
          </div>
        )}
      </aside>
    );
  });
