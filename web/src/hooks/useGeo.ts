// Loads the boundary files and the headshot index once.
import { useEffect, useState } from "react";
import { CONFIG } from "../config";
import { prepareGeo } from "../lib/geo";
import { setHeadshots } from "../lib/headshots";
import type { AreaCollection, Geo } from "../types";

export function useGeo() {
  const [state, setState] = useState<{ geo: Geo | null; error: string | null }>({ geo: null, error: null });
  useEffect(() => {
    let alive = true;
    (async () => {
      const heads = fetch(CONFIG.headshots).then(r => (r.ok ? r.json() : {}) as Promise<{ slugs?: Record<string, unknown> }>).then(j => setHeadshots(j.slugs || {})).catch(() => {});
      for (let attempt = 0; attempt < 4 && alive; attempt++) {
        try {
          const parts = await Promise.all(Object.entries(CONFIG.geo).map(async ([k, u]) => {
            const r = await fetch(u);
            if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
            return [k, (await r.json()) as AreaCollection] as const;
          }));
          await heads;
          if (alive) setState({ geo: prepareGeo(Object.fromEntries(parts) as any), error: null });
          return;
        } catch (e) {
          if (alive) setState(s => ({ ...s, error: (e as Error).message }));
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
    })();
    return () => { alive = false; };
  }, []);
  return state;
}
