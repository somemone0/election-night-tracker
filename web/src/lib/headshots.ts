// Candidate photos live at img/headshots/<first-last>.png; index.json lists which exist.
let SLUGS: Record<string, unknown> = {};
export const setHeadshots = (slugs: Record<string, unknown>) => { SLUGS = slugs || {}; };

const slugsFor = (n: string) => {
  const s = (n || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return [s, s.split("-").filter(p => p.length > 1).join("-")];   // second form drops middle initials: "Igor A. Tregub" -> igor-tregub
};
export function headshotOf(n: string): string | null {
  for (const s of slugsFor(n)) if (SLUGS[s]) return `img/headshots/${s}.png`;
  return null;
}
export const initials = (n: string) =>
  n.split(/\s+/).filter(w => /[A-Za-z]/.test(w[0] || "")).map(w => w[0]).slice(0, 2).join("").toUpperCase();
