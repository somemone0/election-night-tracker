// Polls results.json and history.json. Built to keep showing the last good numbers no matter what the network does:
// one request at a time, a timeout on each, a basic shape check before anything replaces the current data, a retry
// with backoff after failures, and an immediate refresh when the tab comes back into view.
import { useEffect, useRef, useState } from "react";
import { CONFIG } from "../config";
import type { HistoryPoint, Results } from "../types";

export interface Feed {
  data: Results | null;
  history: HistoryPoint[];
  error: string | null;        // last failure, cleared on the next success
  lastOk: number | null;       // when we last got good data (ms)
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const r = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store", signal });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export function looksLikeResults(x: unknown): x is Results {
  const d = x as Results;
  return !!d && typeof d === "object" && typeof d.generated_at === "string" && Array.isArray(d.races) && !!d.meta && typeof d.meta === "object"
    && Array.isArray(d.state_measures) && !!d.headline;
}

export function useResults(): Feed {
  const [feed, setFeed] = useState<Feed>({ data: null, history: [], error: null, lastOk: null });
  const busy = useRef(false);

  useEffect(() => {
    let alive = true, timer = 0, failures = 0;

    const schedule = (ms: number) => { window.clearTimeout(timer); timer = window.setTimeout(tick, ms); };
    async function tick() {
      if (busy.current || !alive) return;
      busy.current = true;
      const ctl = new AbortController(), to = window.setTimeout(() => ctl.abort(), CONFIG.fetchTimeoutMs);
      try {
        const [res, hist] = await Promise.all([
          getJson<unknown>(CONFIG.results, ctl.signal),
          getJson<HistoryPoint[]>(CONFIG.history, ctl.signal).catch(() => null),
        ]);
        if (!looksLikeResults(res)) throw new Error("results.json is not in the expected format");
        failures = 0;
        if (alive) setFeed(prev => ({
          // keep the same object when nothing changed, so nothing downstream re-renders
          data: prev.data && prev.data.generated_at === res.generated_at ? prev.data : res,
          history: Array.isArray(hist) ? (hist.length === prev.history.length ? prev.history : hist) : prev.history,
          error: null, lastOk: Date.now(),
        }));
      } catch (e) {
        failures++;
        const msg = location.protocol === "file:" ? "Open through a web server (python3 tracker.py --serve 8077)"
          : (e as Error).name === "AbortError" ? "results.json timed out" : (e as Error).message;
        if (alive) setFeed(prev => ({ ...prev, error: msg }));
      } finally {
        window.clearTimeout(to);
        busy.current = false;
        if (alive) schedule(failures ? Math.min(CONFIG.refreshMs, 2000 * 2 ** (failures - 1)) : CONFIG.refreshMs);
      }
    }
    const onVisible = () => { if (document.visibilityState === "visible") schedule(0); };
    document.addEventListener("visibilitychange", onVisible);
    tick();
    return () => { alive = false; window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  return feed;
}
