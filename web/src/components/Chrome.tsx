// Top bar (title, status, level toggle), notices, and the map legend.
import { CONFIG, LEVEL_LABEL, LEVELS } from "../config";
import type { Feed } from "../hooks/useResults";
import type { Level, View } from "../types";

export function TopBar({ feed, view, names, onLevel }: { feed: Feed; view: View; names: Record<Level, string | null>; onLevel: (l: Level) => void }) {
  const D = feed.data;
  const age = D ? Date.now() - new Date(D.generated_at).getTime() : Infinity;
  const stale = !D || age > CONFIG.staleAfterMs || (!!feed.error && !!feed.lastOk && Date.now() - feed.lastOk > CONFIG.staleAfterMs);
  const when = D ? new Date(D.generated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : null;
  const text = !D ? (feed.error ?? "loading") : (age > CONFIG.staleAfterMs ? "tracker last updated " : "updated ") + when;
  return (
    <header className="topbar">
      <div className="mark" aria-hidden="true"><span className={"dot" + (!D ? " wait" : stale ? " stale" : "")} /></div>
      <div className="titles">
        <div className="ttl">{CONFIG.masthead}</div>
        <div className="sub" role="status">{text} · berkeley, alameda county and california results</div>
      </div>
      <div className="levels" role="group" aria-label="Level of results">
        {LEVELS.map(level => (
          <button key={level} type="button" aria-pressed={view.level === level} disabled={!names[level]} onClick={() => onLevel(level)}>
            <b>{LEVEL_LABEL[level].toUpperCase()}</b><span>{names[level] ?? "—"}</span>
          </button>
        ))}
      </div>
    </header>
  );
}

export function Banners({ feed }: { feed: Feed }) {
  const D = feed.data;
  const items: { text: string; info?: boolean }[] = [];
  if (D?.meta.mock) items.push({ info: true, text: "Test mode: these numbers are simulated by the mock server and are not real election results." });
  for (const w of D?.meta.warnings || []) items.push({ text: w });
  if (D?.meta.alameda?.roster_only) items.push({ info: true, text: "Candidates shown are from the county’s zero report. No votes have been counted yet." });
  const names: Record<string, string> = { sos_state: "Secretary of State", sos_alameda: "SoS Alameda feed", alameda: "Alameda County", gov_state: "SoS governor", gov_alameda: "SoS Alameda governor" };
  const stale = D ? Object.keys(names).filter(k => (D.meta[k] as { stale?: boolean } | undefined)?.stale) : [];
  if (stale.length) items.push({ text: `Some sources could not be reached on the last update (${stale.map(k => names[k]).join(", ")}). Showing the last numbers received.` });
  if (D && feed.error) items.push({ text: `Can’t reach the tracker right now (${feed.error}). Showing the last numbers received; retrying.` });
  if (!items.length) return null;
  return <div className="banners">{items.map((b, i) => <div key={i} className={"banner" + (b.info ? " mock" : "")}>{b.text}</div>)}</div>;
}

export function Legend({ empty }: { empty: boolean }) {
  return (
    <div className="legend" aria-label="How to read the cards">
      <span className="ttl">each card is a race; the leader is outlined</span>
      <div className="row"><span className="chip">+7.5 pts</span>leader’s margin, in percentage points</div>
      <div className="row"><span className="ring" />race within 3 points</div>
      <p className="hint">{empty ? "no races reported for this area yet. zoom out, or wait for the county’s nov. 3 results." : "scroll or pinch to zoom · tap a card or a district →"}</p>
    </div>
  );
}
