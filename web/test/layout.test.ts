import { describe, expect, it } from "vitest";
import { layoutCards, rectFor, type LayoutItem, type Offset } from "../src/lib/layout";

const box = { top: 0, left: 0, right: 1000, bottom: 800 };
const item = (key: string, x: number, y: number, prio = 1, extra: Partial<LayoutItem> = {}): LayoutItem => ({ key, x, y, w: 180, h: 80, prio, scope: "city", ...extra });
const overlap = (a: ReturnType<typeof rectFor>, b: ReturnType<typeof rectFor>) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("card layout", () => {
  it("cards on the same point never overlap", () => {
    const items = [1, 2, 3, 4, 5].map(i => item("c" + i, 500, 400, i));
    const { offsets } = layoutCards(items, box, new Map());
    const rects = items.map(it => rectFor(it, offsets.get(it.key)!));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j])).toBe(false);
  });
  it("the first card sits straight above its point", () => {
    const { offsets } = layoutCards([item("a", 500, 400)], box, new Map());
    expect(offsets.get("a")).toEqual({ below: false, lift: 0, dx: 0 });
  });
  it("keeps a card's previous spot when it still fits (no hopping)", () => {
    const prev = new Map<string, Offset | null>([["a", { below: true, lift: 0, dx: 0 }]]);
    const { offsets } = layoutCards([item("a", 500, 400)], box, prev);
    expect(offsets.get("a")).toBe(prev.get("a"));
  });
  it("cards with no room are hidden and counted on the '+N more' chip", () => {
    const tiny = { top: 0, left: 0, right: 400, bottom: 300 };
    const items = [1, 2, 3, 4, 5, 6, 7, 8].map(i => item("c" + i, 200, 150, i));
    items.push(item("more", 200, 150, 99, { more: true, moreCount: 2 }));
    const { offsets, moreCount } = layoutCards(items, tiny, new Map());
    const hidden = items.filter(i => !i.more && offsets.get(i.key) === null).length;
    expect(hidden).toBeGreaterThan(0);
    expect(moreCount).toBe(2 + hidden);
  });
  it("pinned cards stay centered on their point and the others move out of their way", () => {
    const items = [item("d4", 500, 400, 1, { pin: true }), item("c", 500, 400, 0)];
    const { offsets } = layoutCards(items, box, new Map());
    expect(offsets.get("d4")).toEqual({ below: false, lift: 0, dx: 0, center: true });
    expect(overlap(rectFor(items[0], offsets.get("d4")!), rectFor(items[1], offsets.get("c")!))).toBe(false);
  });
  it("stays clear of areas it is told to avoid", () => {
    const { offsets } = layoutCards([item("a", 100, 100)], { ...box, avoid: [{ x: 0, y: 0, w: 300, h: 100 }] }, new Map());
    const r = rectFor(item("a", 100, 100), offsets.get("a")!);
    expect(overlap(r, { x: 0, y: 0, w: 300, h: 100 })).toBe(false);
  });
});
