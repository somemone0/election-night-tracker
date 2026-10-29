// Place cards so they never cover each other: straight up from their point, then nudged sideways, stacked, or below.
// Pinned cards (council districts) go first, centered on their point, and never move; the rest avoid them.
// Pure: takes screen points and card sizes, returns an offset per card (or null = no room, hide it).

export interface Offset { below: boolean; lift: number; dx: number; center?: boolean }
export interface LayoutItem { key: string; x: number; y: number; w: number; h: number; prio: number; more?: boolean; moreCount?: number; scope: string; pin?: boolean }
export interface Bounds { top: number; left: number; right: number; bottom: number; avoid?: { x: number; y: number; w: number; h: number }[] }

export const GAP = 10, TAIL = 12;

interface Rect { x: number; y: number; w: number; h: number }
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const rectFor = (it: { x: number; y: number; w: number; h: number }, o: Offset): Rect => ({
  x: it.x - it.w / 2 + o.dx,
  y: o.center ? it.y - it.h / 2 : o.below ? it.y + TAIL + o.lift : it.y - TAIL - o.lift - it.h,
  w: it.w, h: it.h,
});

export const PINNED: Offset = { below: false, lift: 0, dx: 0, center: true };
const same = (a: Offset, b: Offset) => a.below === b.below && a.lift === b.lift && a.dx === b.dx && !!a.center === !!b.center;

export function layoutCards(items: LayoutItem[], bounds: Bounds, prev: Map<string, Offset | null>) {
  const placed: Rect[] = [...(bounds.avoid || [])];
  const out = new Map<string, Offset | null>();
  let hiddenCity = 0;
  let moreItem: LayoutItem | null = null;

  const place = (it: LayoutItem): Offset | null => {
    const options: Offset[] = [];
    const was = prev.get(it.key);
    if (was) options.push(was);   // keep the last spot if it still works, so cards do not hop around
    for (const below of [false, true]) for (let i = 0; i < 4; i++)
      for (const dx of [0, it.w * 0.55 + GAP, -(it.w * 0.55 + GAP), it.w + GAP, -(it.w + GAP)])
        options.push({ below, lift: i * (it.h + GAP), dx: Math.round(dx) });
    for (const o of options) {
      const r = rectFor(it, o);
      const inView = r.y >= bounds.top && r.y + r.h <= bounds.bottom && r.x >= bounds.left && r.x + r.w <= bounds.right;
      if (!inView || placed.some(q => overlaps(q, r))) continue;
      placed.push(r);
      return was && same(was, o) ? was : o;
    }
    return null;
  };

  for (const it of items.filter(i => i.pin)) {   // always shown, always on their point
    placed.push(rectFor(it, PINNED));
    out.set(it.key, prev.get(it.key)?.center ? prev.get(it.key)! : PINNED);
  }
  for (const it of [...items].filter(i => !i.pin).sort((a, b) => a.prio - b.prio)) {
    if (it.more) { moreItem = it; continue; }   // placed last, once we know what did not fit
    const o = place(it);
    out.set(it.key, o);
    if (!o && it.scope === "city") hiddenCity++;
  }
  let moreCount = 0;
  if (moreItem) {
    moreCount = (moreItem.moreCount || 0) + hiddenCity;
    out.set(moreItem.key, place(moreItem));
  }
  return { offsets: out, moreCount };
}
