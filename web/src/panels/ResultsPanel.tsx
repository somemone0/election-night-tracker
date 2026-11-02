// The race column. A new race replaces the old one at once and scrolls back to the top; new numbers for the same race
// update in place, keeping the scroll spot.
import { forwardRef, useLayoutEffect, useRef } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Detail, type DetailProps } from "./Detail";
import { S } from "../strings";

export const ResultsPanel = forwardRef<HTMLElement, DetailProps>(
  function ResultsPanel({ sel, ...rest }, ref) {
    const scroller = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [sel]);
    return (
      <aside className="results" aria-label={S.panelLabel} ref={ref}>
        <div className="rscroll" ref={scroller}>
          <div className="pane" aria-live="polite">
            <ErrorBoundary label={S.partResults} resetKey={rest.D.generated_at + sel}>
              <Detail {...rest} sel={sel} />
            </ErrorBoundary>
          </div>
        </div>
      </aside>
    );
  });
