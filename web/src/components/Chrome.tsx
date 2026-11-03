// Top bar (title, status, level toggle), notices, and the map legend.
import { CONFIG, LEVEL_LABEL, LEVELS } from "../config";
import { apTime } from "../lib/format";
import type { Feed } from "../hooks/useResults";
import type { Level, View } from "../types";
import { S } from "../strings";

export function TopBar({ feed, view, names, onLevel }: { feed: Feed; view: View; names: Record<Level, string | null>; onLevel: (l: Level) => void }) {
  const D = feed.data;
  const age = D ? Date.now() - new Date(D.generated_at).getTime() : Infinity;
  const when = D ? apTime(new Date(D.generated_at)) : null;
  const text = !D ? (feed.error ?? S.loading) : (age > CONFIG.staleAfterMs ? S.trackerLastUpdated : S.updated) + when;
  return (
    <header className="topbar">
      <a href="https://data.dailycal.org" className="mark"><img src="img/dailycal-profile.jpg" alt={S.paper} width={44} height={44} /></a>
      <div className="titles">
        <div className="ttl">{CONFIG.masthead}</div>
        <div className="sub" role="status">{text}</div>
      </div>
      <div className="levels" role="group" aria-label={S.levelsLabel}>
        {LEVELS.map(level => (
          <button key={level} type="button" aria-pressed={view.level === level} disabled={!names[level]} onClick={() => onLevel(level)}>
            <b>{LEVEL_LABEL[level]}</b><span>{names[level] ?? S.noLevel}</span>
          </button>
        ))}
      </div>
    </header>
  );
}

export function Banners({ feed }: { feed: Feed }) {
  const D = feed.data;
  const items: { text: string; info?: boolean }[] = [];
  for (const w of D?.meta.warnings || []) items.push({ text: w });
  if (D && feed.error) items.push({ text: S.cantReach });
  if (!items.length) return null;
  return <div className="banners">{items.map((b, i) => <div key={i} className={"banner" + (b.info ? " mock" : "")}>{b.text}</div>)}</div>;
}

export function Legend() {
  return <div className="legend" aria-label={S.legend}><div className="row"><span className="ring" />{S.withinThree}</div></div>;
}
