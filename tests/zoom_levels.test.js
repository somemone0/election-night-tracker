// Checks which area the map selects at each zoom, using the real boundary files and the page's own functions.
// Run: node tests/zoom_levels.test.js
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "site/classic.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const take = (from, to) => script.slice(script.indexOf(from), script.indexOf(to));

const ctx = { Math, Object, String, Number, console };
vm.createContext(ctx);
vm.runInContext(
  take("const CONFIG = {", "/* ================= helpers") +
  take("/* ================= geometry helpers", "/* ================= navigation") +
  take("function bandLevel", "function centerStillInside") +
  "var GEO = {};", ctx);
for (const k of ["state", "county", "congress", "city"]) ctx.GEO[k] = JSON.parse(fs.readFileSync(path.join(root, `site/geo/${k}.json`)));
vm.runInContext("localizeCities()", ctx);   // only Berkeley is selectable at city level

// effective zoom for a given map zoom, as the page computes it for a 1000x740 map
const place = { Berkeley: [37.8715, -122.273], Oakland: [37.80, -122.25], Livermore: [37.68, -121.77], Fremont: [37.55, -121.99], Hayward: [37.67, -122.08] };
const levelsAt = (name, z) => { const [lat, lng] = place[name]; const v = vm.runInContext(`viewFromBand({lat:${lat},lng:${lng}},${z})`, ctx); return `${v.level}:${v.id}`; };

const seq = (name) => [6, 7, 8, 9, 10, 11, 12, 13, 14].map(z => levelsAt(name, z + 0));
console.log("Berkeley ", seq("Berkeley").join("  "));
console.log("Livermore", seq("Livermore").join("  "));
console.log("Fremont  ", seq("Fremont").join("  "));

// every level is reachable by zooming in over Berkeley, in order state -> county -> congress -> city
const order = seq("Berkeley").map(s => s.split(":")[0]);
assert.deepStrictEqual([...new Set(order)], ["state", "county", "congress", "city"]);
assert.strictEqual(levelsAt("Berkeley", 13), "city:Berkeley");
assert.strictEqual(levelsAt("Berkeley", 11), "congress:12");
assert.strictEqual(levelsAt("Berkeley", 9), "county:alameda");
assert.strictEqual(levelsAt("Livermore", 11), "congress:14");   // districts other than 12 work too
assert.strictEqual(levelsAt("Livermore", 13), "congress:14");   // other cities have no city level; you stay on the district
assert.strictEqual(levelsAt("Fremont", 14), "congress:14");
// outside the county the band falls back to the state
const sf = vm.runInContext(`viewFromBand({lat:37.77,lng:-122.45},11)`, ctx);
assert.strictEqual(sf.level, "state");
console.log("ok");
