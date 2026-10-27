import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { prepareGeo } from "../src/lib/geo";
import type { Geo, Results } from "../src/types";

export const ROOT = path.resolve(__dirname, "../..");

export function loadGeo(): Geo {
  const raw = Object.fromEntries(["state", "county", "congress", "city", "ward"].map(k => [k, JSON.parse(fs.readFileSync(path.join(ROOT, `site/geo/${k}.json`), "utf8"))]));
  return prepareGeo(raw as any);
}

/** A mock-election snapshot from the real tracker code, 5 hours into the night. */
export function mockResults(port = 8794): Results {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cards-"));
  try {
    execFileSync("python3", ["tracker.py", "--mock", "--mock-port", String(port), "--start", "300", "--speed", "0", "--once", "--out", tmp], { cwd: ROOT, stdio: "pipe" });
    return JSON.parse(fs.readFileSync(path.join(tmp, "results.json"), "utf8"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Races as they look before the county posts Nov. 3 (filled from the zero report). */
export function rosterRaces() {
  return JSON.parse(execFileSync("python3", ["-c", "import json,tracker;print(json.dumps(tracker.with_roster({'updated':'x','title':'placeholder','races':[]})['races']))"], { cwd: ROOT }).toString());
}
