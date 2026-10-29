#!/usr/bin/env python3
"""Election-night tracker: Prop 40, Alameda County, City of Berkeley.

Polls two public sources and writes site/data/results.json (+ history.json and
races.csv) for the static page in site/:

  * CA Secretary of State Election Night feed  -> statewide + Alameda measures (Prop 40)
  * Alameda County Registrar results page      -> county, Berkeley, and district contests

Live:   python3 tracker.py --serve 8000
Demo:   python3 tracker.py --mock --speed 60 --interval 5 --serve 8000
Once:   python3 tracker.py --once --sos-base http://127.0.0.1:8765 --alameda-base http://127.0.0.1:8765
"""
import argparse
import csv
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import alameda_parse
import calls
import rtm

HERE = Path(__file__).resolve().parent
SOS_BASE = "https://api.sos.ca.gov"
ALAMEDA_BASE = "https://alamedacountyca.gov"
ELECTION_ID = "262"  # Nov 3, 2026 General on the Alameda results system
HEADLINE_MEASURE = "40"
ELECTION_DATE = date(2026, 11, 3)
ELECTION_LABEL = "November 03, 2026"  # as printed in the county page title
USER_AGENT = "election-tracker/1.0 (newsroom results tracker)"
HISTORY_LIMIT = 3000


# --------------------------------------------------------------------------- fetch
class FetchError(Exception):
    pass


def fetch(url, timeout=20, retries=1):
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
            time.sleep(1)
    raise FetchError(f"{url}: {last}")


def fetch_json(url):
    body = fetch(url)
    try:
        return json.loads(body)
    except ValueError as e:
        raise FetchError(f"{url}: bad JSON ({e})")


# --------------------------------------------------------------------------- normalize
def num(s):
    try:
        return int(str(s).replace(",", ""))
    except ValueError:
        return 0


def parse_reporting(s):
    """'47.2% (11,264 of 23,863) precincts reporting' -> dict"""
    m = re.search(r"([\d.]+)%\s*\(([\d,]+) of ([\d,]+)\)", s or "")
    if not m:
        return None
    return {"pct": float(m.group(1)), "done": num(m.group(2)), "total": num(m.group(3))}


def measure_summary(yes, no):
    total = yes + no
    yp = round(100 * yes / total, 2) if total else 0.0
    np_ = round(100 * no / total, 2) if total else 0.0
    if not total:
        leader = None
    elif yes == no:
        leader = "tied"
    else:
        leader = "yes" if yes > no else "no"
    return {"yes": yes, "no": no, "total": total, "yes_pct": yp, "no_pct": np_, "leader": leader, "margin": round(abs(yp - np_), 2)}


def normalize_sos(doc):
    out = {
        "title": doc.get("raceTitle"),
        "reporting_time": doc.get("ReportingTime"),
        "precincts": parse_reporting(doc.get("Reporting")),
        "measures": {},
    }
    for m in doc.get("ballot-measures", []):
        s = measure_summary(num(m["yesVotes"]), num(m["noVotes"]))
        s.update(number=str(m["Number"]).lstrip("0") or "0", name=m["Name"])
        out["measures"][s["number"]] = s
    if not out["measures"]:
        raise FetchError("SoS feed has no ballot measures")
    return out


def normalize_contest(doc):
    """SoS candidate contest (e.g. /returns/governor). The statewide call returns an object, the county call a list."""
    if isinstance(doc, list):
        doc = doc[0] if doc else {}
    cands = [
        {"name": c["Name"], "party": c.get("Party"), "votes": num(c["Votes"]), "incumbent": bool(c.get("incumbent"))}
        for c in doc.get("candidates", [])
    ]
    if not cands:
        raise FetchError("SoS contest feed has no candidates")
    total = sum(c["votes"] for c in cands)
    for c in cands:
        c["pct"] = round(100 * c["votes"] / total, 2) if total else 0.0
    cands.sort(key=lambda c: -c["votes"])
    return {
        "title": doc.get("raceTitle"),
        "reporting_time": doc.get("ReportingTime"),
        "precincts": parse_reporting(doc.get("Reporting")),
        "total": total,
        "candidates": cands,
    }


def feed_date(reporting_time):
    m = re.search(r"([A-Z][a-z]+) (\d{1,2}), (\d{4})", reporting_time or "")
    if not m:
        return None
    try:
        return datetime.strptime(" ".join(m.groups()), "%B %d %Y").date()
    except ValueError:
        return None


def feed_warnings(sos_state, alameda):
    """Things that mean the numbers are not real Nov 3 results yet (test data, placeholder pages)."""
    out = []
    d = feed_date(sos_state["reporting_time"]) if sos_state else None
    if d and d < ELECTION_DATE:
        out.append("Statewide numbers are pre-election test data, not results.")
    if alameda and ELECTION_LABEL not in (alameda["title"] or ""):
        out.append("Alameda County hasn't posted Nov. 3 results yet.")
    return out


CITIES = ["Alameda", "Albany", "Berkeley", "Dublin", "Emeryville", "Fremont", "Hayward", "Livermore", "Newark",
          "Oakland", "Piedmont", "Pleasanton", "San Leandro", "Union City"]  # matches site/geo/city.json
CD_RE = re.compile(r"^U\.S\. Representative, (\d+)(?:st|nd|rd|th) Congressional District")
CITY_OF_RE = re.compile(r"City of (.+?)\s*$")


def classify(race, county_precincts):
    """-> (group, city, congressional district). Groups: city, congress, county, turnout, prop, other."""
    title = race["title"]
    m = CD_RE.match(title)
    if m:
        return "congress", None, int(m.group(1))
    if race["category"] == "City" and race["subcategory"] in CITIES:
        return "city", race["subcategory"], None
    m = CITY_OF_RE.search(title)
    if m and m.group(1) in CITIES:
        return "city", m.group(1), None
    if race["category"] == "Registration & Turnout":
        return "turnout", None, None
    if race["category"] == "State" and title.startswith("Proposition"):
        return "prop", None, None
    p = race["precincts"]
    if p and county_precincts and p["total"] >= county_precincts:
        return "county", None, None
    return "other", None, None


def normalize_alameda(parsed):
    races = []
    county_precincts = max((r["precincts"]["total"] for r in parsed["races"] if r["precincts"]), default=0)
    for i, r in enumerate(parsed["races"]):
        group, city, cd = classify(r, county_precincts)
        item = {
            "id": f"r{i}",
            "group": group,
            "city": city,
            "cd": cd,
            "category": r["category"],
            "subcategory": r["subcategory"],
            "title": r["title"],
            "kind": r["kind"],
            "rcv": r["rcv"],
            "rule": r["passing"] or None,
            "seats": r.get("seats") or 1,
            "precincts": r["precincts"],
        }
        if r["kind"] == "measure":
            yes, no = r["rows"][0]["votes"], r["rows"][1]["votes"]
            item.update(measure_summary(yes, no))
        else:
            total = sum(x["votes"] for x in r["rows"])
            rows = [
                {"name": x["name"], "votes": x["votes"], "pct": round(100 * x["votes"] / total, 2) if total else 0.0}
                for x in r["rows"]
            ]
            item["rows"] = sorted(rows, key=lambda x: -x["votes"])
            item["total"] = total
        races.append(item)
    if not races:
        raise FetchError("no races found on the Alameda results page (layout change or error page?)")
    return {"updated": parsed["updated"], "title": parsed["title"], "races": races}


ROSTER_FIXTURE = HERE / "fixtures" / "alameda_zero_report.html"


def with_roster(alameda):
    """Until the county posts the Nov. 3 page, use the candidate lists from its zero report (all votes 0),
    so the map can show every race and candidate. The snapshot is flagged roster_only."""
    if ELECTION_LABEL in (alameda["title"] or ""):
        return alameda
    roster = normalize_alameda(alameda_parse.parse(ROSTER_FIXTURE.read_text(encoding="utf-8", errors="replace")))
    roster.update(updated=alameda["updated"], title=alameda["title"], roster_only=True)
    return roster


# --------------------------------------------------------------------------- snapshot
def build_snapshot(sos_state, sos_alameda, alameda, errors, gov_state=None, gov_alameda=None):
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    snap = {
        "generated_at": now,
        "meta": {
            "sos_state": {"reporting_time": None, "precincts": None, "ok": False, "stale": False},
            "sos_alameda": {"reporting_time": None, "precincts": None, "ok": False, "stale": False},
            "alameda": {"updated": None, "title": None, "ok": False, "stale": False},
            "gov_state": {"ok": False, "stale": False},
            "gov_alameda": {"ok": False, "stale": False},
            "errors": errors,
            "warnings": feed_warnings(sos_state, alameda),
        },
    }
    for key, val in (("sos_state", sos_state), ("sos_alameda", sos_alameda)):
        if val:
            snap["meta"][key].update(ok=True, reporting_time=val["reporting_time"], precincts=val["precincts"])
    if alameda:
        snap["meta"]["alameda"].update(ok=True, updated=alameda["updated"], title=alameda["title"], roster_only=bool(alameda.get("roster_only")))
    for key, val in (("gov_state", gov_state), ("gov_alameda", gov_alameda)):
        if val:
            snap["meta"][key]["ok"] = True

    snap["contests"] = {}
    if gov_state or gov_alameda:
        snap["contests"]["governor"] = {"state": gov_state, "alameda": gov_alameda}

    headline = {"number": HEADLINE_MEASURE}
    if sos_state and HEADLINE_MEASURE in sos_state["measures"]:
        m = sos_state["measures"][HEADLINE_MEASURE]
        headline["name"] = m["name"]
        headline["state"] = {**{k: m[k] for k in ("yes", "no", "yes_pct", "no_pct", "leader", "margin")}, "precincts": sos_state["precincts"]}
    if sos_alameda and HEADLINE_MEASURE in sos_alameda["measures"]:
        m = sos_alameda["measures"][HEADLINE_MEASURE]
        headline["name"] = headline.get("name") or m["name"]
        headline["alameda"] = {**{k: m[k] for k in ("yes", "no", "yes_pct", "no_pct", "leader", "margin")}, "precincts": sos_alameda["precincts"]}
    if alameda and not alameda.get("roster_only"):   # zero-report placeholders would not match the state feed
        page = next((r for r in alameda["races"] if r["title"] == f"Proposition {HEADLINE_MEASURE}"), None)
        if page:
            headline["alameda_page"] = {k: page[k] for k in ("yes", "no", "yes_pct", "no_pct", "leader", "precincts")}
    if "alameda" in headline and "alameda_page" in headline:
        a, b = headline["alameda"], headline["alameda_page"]
        # two independent publishers of the same number: flag disagreement (they update on different clocks)
        headline["alameda_sources_agree"] = (a["yes"], a["no"]) == (b["yes"], b["no"])
    snap["headline"] = headline

    snap["state_measures"] = []
    if sos_state:
        for number, m in sos_state["measures"].items():
            row = {"number": number, "name": m["name"], "state": {k: m[k] for k in ("yes", "no", "yes_pct", "no_pct", "leader", "margin")}}
            if sos_alameda and number in sos_alameda["measures"]:
                a = sos_alameda["measures"][number]
                row["alameda"] = {k: a[k] for k in ("yes", "no", "yes_pct", "no_pct", "leader", "margin")}
            snap["state_measures"].append(row)

    snap["races"] = [r for r in (alameda["races"] if alameda else []) if r["group"] in ("city", "congress", "county", "turnout")]
    return snap


def history_point(snap):
    h = snap["headline"]
    pt = {
        "t": snap["generated_at"],
        "sos_time": snap["meta"]["sos_state"]["reporting_time"],
        "alameda_updated": snap["meta"]["alameda"]["updated"],
    }
    if "state" in h:
        pt["state_yes_pct"] = h["state"]["yes_pct"]
        pt["state_votes"] = h["state"]["yes"] + h["state"]["no"]
        pt["state_precincts_pct"] = (h["state"]["precincts"] or {}).get("pct")
    if "alameda" in h:
        pt["alameda_yes_pct"] = h["alameda"]["yes_pct"]
        pt["alameda_votes"] = h["alameda"]["yes"] + h["alameda"]["no"]
    return pt


def write_outputs(out_dir, snap):
    out_dir.mkdir(parents=True, exist_ok=True)
    atomic_write(out_dir / "results.json", json.dumps(snap, indent=1))

    hist_path = out_dir / "history.json"
    try:
        hist = json.loads(hist_path.read_text())
    except (OSError, ValueError):
        hist = []
    pt = history_point(snap)
    key = lambda p: (p.get("sos_time"), p.get("alameda_updated"), p.get("state_votes"), p.get("alameda_votes"))
    if pt.get("state_votes", 0) > 0 and (not hist or key(hist[-1]) != key(pt)):
        hist.append(pt)
        hist = hist[-HISTORY_LIMIT:]
        atomic_write(hist_path, json.dumps(hist))

    lines = [["group", "city", "congress", "title", "choice", "votes", "pct", "precincts_done", "precincts_total"]]
    for r in snap["races"]:
        p = r.get("precincts") or {}
        if r["kind"] == "measure":
            rows = [("Yes", r["yes"], r["yes_pct"]), ("No", r["no"], r["no_pct"])]
        else:
            rows = [(x["name"], x["votes"], x["pct"]) for x in r["rows"]]
        for name, votes, pct in rows:
            lines.append([r["group"], r.get("city"), r.get("cd"), r["title"], name, votes, pct, p.get("done"), p.get("total")])
    tmp = out_dir / "races.csv.tmp"
    with open(tmp, "w", newline="") as f:
        csv.writer(f).writerows(lines)
    tmp.replace(out_dir / "races.csv")


def atomic_write(path, text):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    tmp.replace(path)


# --------------------------------------------------------------------------- poll loop
class Tracker:
    def __init__(self, sos_base, alameda_base, election_id, out_dir, mock=False, rtm_sources=None, rtm_manual=None, rtm_sources_path=None,
                 calls_path=None):
        self.mock = mock
        self.calls_path = calls_path   # editors' calls and outstanding-ballot counts; re-read every poll
        self.caller = calls.Caller()
        self.rtm_sources = rtm_sources or {}
        self.rtm_sources_path = rtm_sources_path   # re-read every poll, so new addresses apply without a restart
        self.rtm_manual = rtm_manual
        self.sos_base = sos_base.rstrip("/")
        self.alameda_base = alameda_base.rstrip("/")
        self.election_id = election_id
        self.out_dir = out_dir
        self.last = {k: None for k in ("sos_state", "sos_alameda", "alameda", "gov_state", "gov_alameda")}

    def poll(self):
        errors = []
        fresh = {}
        jobs = {
            "sos_state": lambda: normalize_sos(fetch_json(f"{self.sos_base}/returns/ballot-measures")),
            "sos_alameda": lambda: normalize_sos(fetch_json(f"{self.sos_base}/returns/ballot-measures/county/alameda")),
            "gov_state": lambda: normalize_contest(fetch_json(f"{self.sos_base}/returns/governor")),
            "gov_alameda": lambda: normalize_contest(fetch_json(f"{self.sos_base}/returns/governor/county/alameda")),
            "alameda": lambda: with_roster(normalize_alameda(
                alameda_parse.parse(fetch(f"{self.alameda_base}/rovresults/{self.election_id}/").decode("utf-8", "replace"))
            )),
        }
        for name, job in jobs.items():
            try:
                fresh[name] = job()
                self.last[name] = fresh[name]
            except Exception as e:  # keep serving the last good copy of this source
                errors.append({"source": name, "error": str(e), "at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        snap = build_snapshot(
            fresh.get("sos_state") or self.last["sos_state"],
            fresh.get("sos_alameda") or self.last["sos_alameda"],
            fresh.get("alameda") or self.last["alameda"],
            errors,
            gov_state=fresh.get("gov_state") or self.last["gov_state"],
            gov_alameda=fresh.get("gov_alameda") or self.last["gov_alameda"],
        )
        snap["meta"]["mock"] = self.mock
        try:   # Measure RTM across its five counties; a county that cannot be read is listed, not fatal
            alameda = fresh.get("alameda") or self.last["alameda"]
            manual = rtm.load_json(self.rtm_manual) if self.rtm_manual else {}
            if self.rtm_sources_path:
                self.rtm_sources = load_rtm_sources(self.rtm_sources_path) or self.rtm_sources
            snap["rtm"] = rtm.collect(alameda["races"] if alameda else [], partial(fetch, retries=0), self.rtm_sources, manual)
        except Exception as e:
            errors.append({"source": "rtm", "error": str(e), "at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        for name in jobs:
            if name not in fresh and self.last[name]:
                snap["meta"][name]["stale"] = True
        try:   # race calls: editors' desk calls, plus races the count has made certain
            cfg = load_calls(self.calls_path)
            mock_out = fetch_json(f"{self.sos_base}/__mock/outstanding") if self.mock else None
            self.caller.apply(snap, cfg, mock_out)
        except Exception as e:
            errors.append({"source": "calls", "error": str(e), "at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        write_outputs(self.out_dir, snap)
        return snap


def summarize(snap):
    h = snap["headline"]
    bits = []
    if "state" in h:
        bits.append(f"Prop {h['number']} state {h['state']['yes_pct']:.1f}% yes")
    if "alameda" in h:
        bits.append(f"Alameda {h['alameda']['yes_pct']:.1f}%")
    if "alameda_sources_agree" in h and not h["alameda_sources_agree"]:
        bits.append("(SoS vs county page differ)")
    p = snap["meta"]["sos_state"]["precincts"]
    if p:
        bits.append(f"{p['pct']}% precincts")
    r = snap.get("rtm")
    if r:
        bits.append(f"RTM {r['total']['yes_pct']:.1f}% yes ({r['counties_in']}/5 counties)")
    bits.append(f"{len(snap['races'])} races")
    called = sum("call" in r for r in snap["races"])
    if called:
        bits.append(f"{called} called")
    for w in (snap["meta"].get("calls") or {}).get("warnings", []):
        bits.append("CALL CHECK: " + w)
    if snap["meta"]["errors"]:
        bits.append("ERRORS: " + "; ".join(f"{e['source']}: {e['error'][:70]}" for e in snap["meta"]["errors"]))
    return " | ".join(bits)


def mock_rtm_sources(base):
    return {
        "Contra Costa": {"type": "clarity", "url": f"{base}/clarity/CA/Contra_Costa/900001"},
        "Santa Clara": {"type": "clarity", "url": f"{base}/clarity/CA/Santa_Clara/900002"},
        "San Mateo": {"type": "smcacre", "url": f"{base}/smcacre/node/3146"},
        "San Francisco": {"type": "sfelections", "url": f"{base}/sfelections/results/20261103/index.html"},
    }


def load_calls(path):
    """calls.json, or {} when there is none. A file that does not parse is an error (reported), never silently empty."""
    if not path or not Path(path).exists():
        return {}
    try:
        return json.loads(Path(path).read_text())
    except ValueError as e:
        raise ValueError(f"{path} is not valid JSON ({e}); no desk calls applied") from None


def load_rtm_sources(path):
    return {k: v for k, v in rtm.load_json(path).items() if not k.startswith("_")}


def serve_site(site_dir, port, host="127.0.0.1"):
    handler = partial(SimpleHTTPRequestHandler, directory=str(site_dir))
    handler.log_message = lambda *a, **k: None
    srv = ThreadingHTTPServer((host, port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sos-base", default=None, help=f"default {SOS_BASE}")
    ap.add_argument("--alameda-base", default=None, help=f"default {ALAMEDA_BASE}")
    ap.add_argument("--election-id", default=ELECTION_ID)
    ap.add_argument("--interval", type=float, default=60, help="seconds between polls (default 60)")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--out", default=str(HERE / "site" / "data"))
    ap.add_argument("--serve", type=int, metavar="PORT", help="also serve site/ on this port")
    ap.add_argument("--host", default="127.0.0.1", help="address to serve on (0.0.0.0 in a container)")
    ap.add_argument("--rtm-sources", default=str(HERE / "rtm_sources.json"), help="where to read Measure RTM in the other four counties")
    ap.add_argument("--rtm-manual", default=str(HERE / "rtm_manual.json"), help="hand-entered RTM numbers, used when a county cannot be read")
    ap.add_argument("--calls", default=str(HERE / "calls.json"), help="editors' race calls and outstanding-ballot counts (see calls.py)")
    ap.add_argument("--mock", action="store_true", help="start the mock election-night server and poll it")
    ap.add_argument("--mock-port", type=int, default=8765)
    ap.add_argument("--start", type=float, default=-30.0, help="mock clock: sim minutes after 8 p.m.")
    ap.add_argument("--speed", type=float, default=30.0, help="mock clock: sim minutes per real second")
    a = ap.parse_args(argv)

    sos_base, alameda_base = a.sos_base or SOS_BASE, a.alameda_base or ALAMEDA_BASE
    if a.mock:
        import mock_server

        srv = mock_server.make_server(port=a.mock_port, minutes=a.start, speed=a.speed, election_id=a.election_id)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        sos_base = alameda_base = f"http://127.0.0.1:{a.mock_port}"
        print(f"[mock] election night at {sos_base}, clock {a.start:+.0f} min, x{a.speed}/s  (synthetic data!)")

    out_dir = Path(a.out)
    if a.serve:
        serve_site(HERE / "site", a.serve, a.host)
        print(f"[site] http://{a.host}:{a.serve}/", flush=True)

    rtm_sources = load_rtm_sources(a.rtm_sources)
    if a.mock:   # every county's RTM source points at the mock server
        rtm_sources = mock_rtm_sources(sos_base)
    tr = Tracker(sos_base, alameda_base, a.election_id, out_dir, mock=a.mock, rtm_sources=rtm_sources, rtm_manual=a.rtm_manual,
                 rtm_sources_path=None if a.mock else a.rtm_sources, calls_path=a.calls)
    print(f"[poll] SoS {sos_base} | Alameda {alameda_base}/rovresults/{a.election_id}/ | every {a.interval:g}s")
    try:
        while True:
            t0 = time.time()
            snap = tr.poll()
            print(f"[{datetime.now().strftime('%H:%M:%S')}] {summarize(snap)}", flush=True)
            if a.once:
                return 1 if snap["meta"]["errors"] else 0
            time.sleep(max(1.0, a.interval - (time.time() - t0)))
    except KeyboardInterrupt:
        print("\nstopped")
        return 0


if __name__ == "__main__":
    sys.exit(main())
