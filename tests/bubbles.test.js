// Which race bubbles appear at each view, using the real boundaries and a mock-election snapshot.
// Run: node tests/bubbles.test.js   (needs python3 to produce the mock snapshot)
const fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm"), assert = require("assert");
const { execFileSync } = require("child_process");
const root = path.join(__dirname, "..");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bubbles-"));
execFileSync("python3", ["tracker.py", "--mock", "--mock-port", "8793", "--start", "300", "--speed", "0", "--once", "--out", tmp], { cwd: root, stdio: "pipe" });

const html = fs.readFileSync(path.join(root, "site/classic.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\nmain\(\);\s*$/, "\n");
const ctx = { Math, Object, String, Number, console, Set, Promise, document: {}, window: {}, location: { hash: "" }, history: {}, innerWidth: 1200 };
vm.createContext(ctx);
vm.runInContext(script + `
  var __t = { get view() { return view; }, set view(v) { view = v; }, set data(d) { DATA = d; }, set geo(g) { GEO = g; }, set heads(h) { HEADSHOTS = h; }, index: indexCityDistricts,
              visible: () => visibleSpecs(bubbleSpecs()), head: headshotOf };`, ctx);
const t = ctx.__t;
t.geo = Object.fromEntries(["state", "county", "congress", "city", "ward"].map(k => [k, JSON.parse(fs.readFileSync(path.join(root, `site/geo/${k}.json`)))]));
t.data = JSON.parse(fs.readFileSync(path.join(tmp, "results.json")));
t.heads = JSON.parse(fs.readFileSync(path.join(root, "site/img/headshots/index.json"))).slugs;
vm.runInContext("localizeCities()", ctx);
t.index();

const at = (level, id) => { t.view = { level, id }; return t.visible(); };
const tags = specs => specs.map(s => s.tag);

const state = at("state", "CA");
assert(tags(state).includes("Prop 40 · Statewide") && tags(state).includes("Governor"), "state view shows Prop 40 and Governor");
assert(!tags(state).some(x => /Prop 40 · Alameda/.test(x)), "no Alameda Prop 40 card");
assert(tags(state).includes("Measure RTM · 5 counties"), "state view also shows Measure RTM");

const county = at("county", "rtm");
assert.strictEqual(county.filter(s => s.scope === "congress").length, 1, "county view shows CA-12, the only House district on the map");
assert(tags(county).includes("Governor · Alameda Co."));
assert(tags(county).includes("Measure RTM · 5 counties"), "RTM card at county level");
const rc = county.find(s => s.key === "rtm-county");
assert(/5-county total · 5 of 5 in/.test(rc.meta) && rc.who && rc.margin > 0, "RTM card shows the five-county total: " + rc.meta);
assert(county.some(s => s.scope === "cluster" && s.cityName === "Berkeley"), "Berkeley's cluster card shows at county level");

const cd12 = at("congress", "12");
assert(cd12.some(s => s.tag === "U.S. House · CA-12"), "CA-12 card");
assert(!cd12.some(s => s.tag === "U.S. House · CA-14"), "no other districts' House races");
const cdCities = new Set(cd12.filter(s => s.scope === "cluster").map(s => s.cityName));
assert.strictEqual(JSON.stringify([...cdCities]), JSON.stringify(["Berkeley"]), "only Berkeley gets a city card");
const bc = cd12.find(s => s.scope === "cluster" && s.cityName === "Berkeley");
assert(bc.races.length >= 14, "Berkeley cluster carries all its races");

const berk = at("city", "Berkeley");
const wards = berk.filter(s => s.scope === "ward").map(s => s.tag).sort();
assert.strictEqual(JSON.stringify(wards), JSON.stringify(["Council · D1", "Council · D4", "Council · D7", "Council · D8"]));
assert(berk.filter(s => s.scope === "city").length <= 4, "citywide cards are capped (3 + a '+N more' chip)");
assert(berk.some(s => s.more), "more-chip when Berkeley has more races than fit");
assert(berk.some(s => s.key === "rtm-berkeley"), "RTM is in Berkeley's stack");
assert(berk.filter(s => s.scope === "ward").every(s => s.people && s.people.length >= 2), "council cards carry their candidates");

const oak = at("city", "Oakland");
assert(!oak.length, "other cities get no cards");
assert(!at("county", "rtm").some(s => s.scope === "cluster" && s.cityName !== "Berkeley"));

const d4 = berk.find(s => s.tag === "Council · D4");
assert(d4.who && d4.margin > 0 && d4.votes > 0, JSON.stringify(d4));
const p40 = state.find(s => s.key === "p40-state");
assert(["Yes", "No"].includes(p40.who) && p40.margin > 0);

// before the county posts Nov. 3: the tracker fills races from the zero report; cards still show every candidate
const roster = JSON.parse(execFileSync("python3", ["-c", "import json,tracker;print(json.dumps(tracker.with_roster({'updated':'x','title':'placeholder','races':[]})['races']))"], { cwd: root }).toString());
t.data = { ...JSON.parse(fs.readFileSync(path.join(tmp, "results.json"))), races: roster };
const rb = at("city", "Berkeley");
const rw = rb.filter(s => s.scope === "ward");
assert.strictEqual(rw.length, 4, "council cards exist with no votes");
assert(rw.every(s => !s.who && s.people.length >= 2), "no leader yet, candidates listed");
assert(at("county", "rtm").some(s => s.scope === "cluster" && s.cityName === "Berkeley"));

// headshots resolve from names (middle initials, quotes, apostrophes)
for (const [name, ok] of [["Steve Kromer", true], ["Igor A. Tregub", true], ["Majdi 'Gaith' Abuhamdieh", true], ["Shoshana O'Keefe", true], ["Lateefah Simon", false]])
  assert.strictEqual(!!t.head(name), ok, name);

console.log("bubbles ok:", { state: state.length, county: county.length, cd12: cd12.length, berkeley: berk.length });
fs.rmSync(tmp, { recursive: true, force: true });
