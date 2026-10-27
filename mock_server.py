#!/usr/bin/env python3
"""Mock election-night servers for the tracker.

Emulates, from public documentation and the structure of the real pages:

  * CA Secretary of State Election Night Data Feed (api.sos.ca.gov, v20 guide)
      GET /returns/ballot-measures                  statewide measures
      GET /returns/ballot-measures/county/alameda   Alameda County measures
      ?f=csv                                        CSV (UTF-16LE, as the real API serves it)
      GET /returns/governor[/county/alameda]        a candidate contest (county response is a one-item list)
  * Measure RTM in the other four counties (shapes taken from each county's real results output)
      GET /clarity/CA/<County>/<id>/current_ver.txt, /clarity/CA/<County>/<id>/<ver>/json/sum.json   Contra Costa, Santa Clara
      GET /smcacre/node/3146 (links "Results on CSV")  and  /smcacre/media/9099/download             San Mateo
      GET /sfelections/results/20261103/index.html                                                San Francisco
      /__mock/fault?mode=sf403 makes the San Francisco page refuse requests, like the real one does
  * Alameda County Registrar results page
      GET /rovresults/<electionId>/                 HTML, same markup as the real page

All numbers come from one deterministic model of a simulated election night.
The simulated clock starts at poll close (8:00 p.m. Nov 3, 2026), and you can
speed it up, pause it, or jump around it:

    python3 mock_server.py --speed 30            # 30 sim-minutes per real second
    curl 'localhost:8765/__mock/clock?set=240'   # jump to 12:00 a.m.
    curl 'localhost:8765/__mock/clock?speed=0'   # freeze
    curl 'localhost:8765/__mock/fault?mode=500'  # make data endpoints fail (none|500|garbage)

Everything here is synthetic. Do not publish these numbers as results.
"""
import argparse
import hashlib
import json
import math
import re
import threading
import time
from datetime import datetime, timedelta
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import alameda_parse

HERE = Path(__file__).resolve().parent
POLLS_CLOSE = datetime(2026, 11, 3, 20, 0)  # 8:00 p.m. Pacific, naive

STATE = {"precincts": 23863, "ballots": 12_400_000}
ALAMEDA = {"precincts": 627, "ballots": 575_000, "registered": 983_925}
ROLLOFF = 0.93  # share of ballots that vote on a given contest

# final yes share (state, alameda) and early-count drift for the headline measures
HEADLINE = {
    "40": (0.475, 0.640, -0.030),  # wealth tax: late ballots lean yes
    "41": (0.440, 0.360, 0.020),
    "42": (0.460, 0.380, 0.020),
}


# --------------------------------------------------------------------------- model
def h(*parts):
    """Deterministic float in [0, 1) from the given parts."""
    d = hashlib.blake2b("|".join(map(str, parts)).encode(), digest_size=8).digest()
    return int.from_bytes(d, "big") / 2**64


def batch_time(t):
    """Counties release in batches: every 15 min on election night, then every 6 hours."""
    if t < 0:
        return None
    step = 15 if t < 720 else 360
    return math.floor(t / step) * step


def ballots_fraction(t):
    """Share of eventual ballots counted t minutes after poll close (t=None -> nothing)."""
    if t is None:
        return 0.0
    if t >= 43200:  # certified, ~30 days
        return 1.0
    return min(1.0, 0.52 + 0.30 * (1 - math.exp(-t / 160)) + 0.18 * (1 - math.exp(-t / 5000)))


def precincts_fraction(t):
    if t is None:
        return 0.0
    if t >= 2880:
        return 1.0
    return min(1.0, 0.30 + 0.70 * (1 - math.exp(-t / 200)))


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def measure_params(scope, number):
    """(final yes share, early-count drift) for a statewide measure in a scope."""
    n = str(int(number)) if str(number).isdigit() else str(number)
    if n in HEADLINE:
        state_y, alameda_y, drift = HEADLINE[n]
    else:
        state_y = 0.35 + 0.35 * h("state", n)
        alameda_y = clamp(state_y + 0.08 + 0.10 * h("alameda", n), 0.05, 0.95)
        drift = (h("drift", n) - 0.5) * 0.04
    if scope == "alameda":
        return alameda_y, drift * 0.7
    return state_y, drift


@lru_cache(maxsize=None)
def tally_series(key, final_total, final_yes, drift):
    """Cumulative (yes, no) at each batch time.

    Built from per-batch increments so counts never go down. The first batch
    (the mail-ballot drop at poll close) leans by `drift`; later batches drift
    back toward the final share, with a little noise.
    """
    series = {}
    yes = no = 0.0
    prev_f = 0.0
    times = [0] + list(range(15, 720, 15)) + list(range(720, 43201, 360))
    for tb in times:
        f = ballots_fraction(tb)
        delta = (f - prev_f) * final_total
        if prev_f == 0.0:
            share = final_yes + drift  # c(f0) with f0 = 0.52
        else:
            fm = (f + prev_f) / 2
            share = final_yes + drift * (1 - 2 * fm) / 0.48
        share = clamp(share + (h("noise", key, tb) - 0.5) * 0.004, 0.01, 0.99)
        yes += delta * share
        no += delta * (1 - share)
        prev_f = f
        series[tb] = (round(yes), round(no))
    return series


def tally(key, final_total, final_yes, drift, t):
    tb = batch_time(t)
    if tb is None:
        return 0, 0
    return tally_series(key, round(final_total), final_yes, drift)[tb]


def measure_votes(scope, number, t):
    """(yes, no, precincts_done, precincts_total) for a statewide measure in a scope."""
    tb = batch_time(t)
    cfg = STATE if scope == "state" else ALAMEDA
    final_yes, drift = measure_params(scope, number)
    yes, no = tally(f"{scope}:{number}", cfg["ballots"] * ROLLOFF, final_yes, drift, t)
    done = round(cfg["precincts"] * precincts_fraction(tb))
    return yes, no, done, cfg["precincts"]


# Hand-set final shares so the featured race looks like a plausible safe seat (Alameda portion of CA-12).
FIXED_SHARES = {
    "U.S. Representative, 12th Congressional District": {"Lateefah Simon": 0.86, "Jamie Joyce": 0.14},
}


GOVERNOR = [("Xavier Becerra", "Dem"), ("Steve Hilton", "Rep")]
GOV_PARAMS = {"state": (0.545, -0.020), "alameda": (0.830, -0.010)}  # (final share of the first candidate, early drift)


def governor_votes(scope, t):
    """(first candidate's votes, second's, precincts done, precincts total)."""
    cfg = STATE if scope == "state" else ALAMEDA
    final, drift = GOV_PARAMS[scope]
    a, b = tally(f"gov:{scope}", cfg["ballots"] * ROLLOFF, final, drift, t)
    return a, b, round(cfg["precincts"] * precincts_fraction(batch_time(t))), cfg["precincts"]


def candidate_shares(title, names):
    fixed = FIXED_SHARES.get(title)
    if fixed and set(fixed) == set(names):
        return [fixed[n] for n in names]
    w = [0.15 + h("cand", title, n) ** 1.6 for n in names]
    s = sum(w)
    return [x / s for x in w]


def race_precincts_done(title, ptotal, t):
    tb = batch_time(t)
    pf = precincts_fraction(tb)
    if pf >= 0.999:
        return ptotal
    return round(ptotal * pf ** (0.7 + 0.6 * h("p", title)))


def race_rows(race, t):
    """Votes for each row of an Alameda HTML race at sim minute t."""
    tb = batch_time(t)
    f = ballots_fraction(tb)
    title = race["title"]
    ptotal = race["precincts"]["total"] if race["precincts"] else ALAMEDA["precincts"]
    final_total = ptotal * (ALAMEDA["ballots"] / ALAMEDA["precincts"]) * ROLLOFF
    total = final_total * f
    names = [r["name"] for r in race["rows"]]
    if race["kind"] == "measure":
        m = re.match(r"Proposition (\d+)$", title)
        if m:  # must agree with the SoS county feed
            yes, no, _, _ = measure_votes("alameda", m.group(1), t)
        else:
            fy = clamp(0.38 + 0.40 * h("meas", title), 0.05, 0.95)
            drift = (h("mdrift", title) - 0.5) * 0.04
            yes, no = tally(f"html:{title}", final_total, fy, drift, t)
        return [yes, no]
    if "Turnout" in title:
        return None  # handled separately
    if title == "Governor" and set(names) == {n for n, _ in GOVERNOR}:  # must agree with the SoS county feed
        by_name = dict(zip((n for n, _ in GOVERNOR), governor_votes("alameda", t)[:2]))
        return [by_name[n] for n in names]
    shares = candidate_shares(title, names)
    if len(names) == 1:
        shares = [1.0]
    return [round(total * s) for s in shares]


def turnout_rows(t):
    tb = batch_time(t)
    f = ballots_fraction(tb)
    T = ALAMEDA["ballots"]
    total = round(T * f)
    vbm = round(T * (0.52 + 0.45 * (f - 0.52))) if f > 0 else 0
    vbm = min(vbm, total)
    ed = total - vbm
    youth_vbm = round(vbm * 0.06)
    youth_ed = round(ed * 0.06)
    return {
        "Election Day Reporting Turnout": ed,
        "Vote by Mail Reporting Turnout": vbm,
        "Youth Voting Election Day Reporting Turnout": youth_ed,
        "Youth Voting Vote by Mail Reporting Turnout": youth_vbm,
        "Total Ballots Cast": total,
    }


# Measure RTM outside Alameda: (final ballots, precincts, final yes share)
RTM_COUNTIES = {
    "Contra Costa": (560_000, 938, 0.54),
    "San Francisco": (410_000, 514, 0.66),
    "San Mateo": (330_000, 333, 0.57),
    "Santa Clara": (760_000, 1000, 0.49),
}
CLARITY_NAMES = {"Contra_Costa": "Contra Costa", "Santa_Clara": "Santa Clara"}


def rtm_votes(county, t):
    ballots, precincts, share = RTM_COUNTIES[county]
    yes, no = tally(f"rtm:{county}", ballots * ROLLOFF, share, -0.02, t)
    return yes, no, round(precincts * precincts_fraction(batch_time(t))), precincts


# --------------------------------------------------------------------------- clock
class Clock:
    def __init__(self, minutes, speed):
        self.lock = threading.Lock()
        self.set(minutes, speed)

    def set(self, minutes=None, speed=None):
        with self.lock:
            now = self.minutes() if hasattr(self, "base") else -30.0
            self.base = now if minutes is None else float(minutes)
            if speed is not None:
                self.speed = float(speed)
            self.anchor = time.time()

    def minutes(self):
        return self.base + (time.time() - self.anchor) * self.speed

    def snapshot(self):
        return {"minutes_after_close": round(self.minutes(), 2), "speed": self.speed}


def sim_dt(t):
    return POLLS_CLOSE + timedelta(minutes=(batch_time(t) or 0) if t >= 0 else t)


# --------------------------------------------------------------------------- SoS feed
SOS = json.loads((HERE / "fixtures" / "sos_measures.json").read_text())


def fmt_reporting_time(dt):
    hour = dt.hour % 12 or 12
    ap = "a.m." if dt.hour < 12 else "p.m."
    return f"{dt.strftime('%B')} {dt.day}, {dt.year}, {hour}:{dt.minute:02d} {ap}"


def sos_measures(scope, t):
    out = []
    done = total = 0
    for m in SOS["measures"]:
        yes, no, done, total = measure_votes(scope, m["Number"], t)
        tot = yes + no
        yp = round(100 * yes / tot, 1) if tot else 0.0
        np_ = round(100 * no / tot, 1) if tot else 0.0
        out.append(
            {
                "Name": m["Name"],
                "Number": m["Number"],
                "yesVotes": str(yes),
                "yesPercent": f"{yp}",
                "noVotes": str(no),
                "noPercent": f"{np_}",
            }
        )
    pct = round(100 * done / total, 1) if total else 0.0
    return {
        "raceTitle": "Ballot Measures - Statewide Results" if scope == "state" else "Ballot Measures - Alameda Results",
        "Reporting": f"{pct}% ({done:,} of {total:,}) precincts reporting",
        "ReportingTime": fmt_reporting_time(sim_dt(t)),
        "ballot-measures": out,
    }


def sos_governor(scope, t):
    a, b, done, total = governor_votes(scope, t)
    tot = a + b
    pct = round(100 * done / total, 1) if total else 0.0
    cands = []
    for (name, party), v in zip(GOVERNOR, (a, b)):
        cands.append({"Name": name, "Party": party, "Votes": f"{v:,}", "Percent": f"{round(100 * v / tot, 1) if tot else 0.0}", "incumbent": False})
    return {
        "raceTitle": "Governor - Statewide Results" if scope == "state" else "Governor - Alameda County Results",
        "Reporting": f"{pct:g}% ({done:,} of {total:,}) precincts reporting",
        "ReportingTime": fmt_reporting_time(sim_dt(t)),
        "candidates": cands,
    }


def sos_csv(doc):
    """CSV as the real API serves it: UTF-16LE (no BOM), \\n line endings."""
    lines = [f'"{doc["raceTitle"]}"', f'"{doc["Reporting"]}"', f'"{doc["ReportingTime"]}"']
    for m in doc["ballot-measures"]:
        lines.append(f'"{m["Name"]}",{m["Number"]},{m["yesVotes"]},{m["yesPercent"]},{m["noVotes"]},{m["noPercent"]}')
    return ("\n".join(lines) + "\n").encode("utf-16-le")


# --------------------------------------------------------------------------- Alameda page
ALAMEDA_HTML = (HERE / "fixtures" / "alameda_zero_report.html").read_text(encoding="utf-8", errors="replace")
FIXTURE_RACES = {r["title"]: r for r in alameda_parse.parse(ALAMEDA_HTML)["races"]}

TOKEN_RE = re.compile(
    r'(?P<heading><h[34] class="racePanelHeading">(?P<title>[^<]*)</h[34]>)'
    r'|(?P<reported><div class="reported[^"]*"[^>]*>)(?P<rtext>[^<]*Precincts[^<]*)(?P<rend></div>)'
    r'|(?P<row><TR>\s*<TH class="resultsRow[^>]*>(?P<name>[^<]*)</TH>(?P<cells>(?:\s*<TD[^>]*>[^<]*</TD>){2,4})\s*</TR>)',
    re.S,
)
CELL_RE = re.compile(r"(<TD[^>]*>)([^<]*)(</TD>)")


def alameda_page(t, election_id):
    cur = {"title": None, "rows_done": 0, "vals": None, "done": 0, "total": 0}
    turnout = turnout_rows(t)
    registered = ALAMEDA["registered"]

    def pc(v, total):
        return f"{100 * v / total:.2f}" if total else "0.00"

    def sub(m):
        if m.group("heading"):
            title = m.group("title").strip()
            cur.update(title=title, rows_done=0, vals=None)
            race = FIXTURE_RACES.get(title)
            if title == "Propositions":
                cur["vals"] = None
                cur["total"] = ALAMEDA["precincts"]
                cur["done"] = measure_votes("alameda", "1", t)[2]
            elif race and "Turnout" in title:
                cur["vals"] = "turnout"
                cur["total"] = race["precincts"]["total"]
                cur["done"] = race_precincts_done(title, cur["total"], t)
            elif race:
                cur["vals"] = race_rows(race, t)
                cur["total"] = race["precincts"]["total"]
                cur["done"] = race_precincts_done(title, cur["total"], t)
            return m.group(0)
        if m.group("reported"):
            if cur["total"] and cur["title"] is not None and "Precincts" in m.group("rtext"):
                d, tot = cur["done"], cur["total"]
                word = "Reported" if d >= tot else "Partially Reported from Vote Centers"
                text = f"{d} of {tot} Precincts {word} ({100 * d / tot:.2f}% )"
                return m.group("reported") + text + m.group("rend")
            return m.group(0)
        if m.group("row"):
            name = m.group("name").strip()
            cells = list(CELL_RE.finditer(m.group("cells")))
            if cur["title"] == "Propositions" and len(cells) == 4:
                num = re.sub(r"\D", "", name)
                yes, no, _, _ = measure_votes("alameda", num, t)
                tot = yes + no
                vals = [f"{yes:,}", f"{pc(yes, tot)}%", f"{no:,}", f"{pc(no, tot)} %"]
            elif cur["vals"] == "turnout" and len(cells) == 2:
                v = turnout.get(name, 0)
                vals = [f"{v:,}", f"{pc(v, registered)} %"]
            elif isinstance(cur["vals"], list) and len(cells) == 2:
                i = cur["rows_done"]
                cur["rows_done"] += 1
                votes = cur["vals"]
                tot = sum(votes)
                vals = [f"{votes[i]:,}", f"{pc(votes[i], tot)} %"]
            else:
                return m.group(0)
            it = iter(vals)
            body = CELL_RE.sub(lambda c: c.group(1) + next(it) + c.group(3), m.group("cells"))
            return m.group(0).replace(m.group("cells"), body)
        return m.group(0)

    page = TOKEN_RE.sub(sub, ALAMEDA_HTML)
    dt = sim_dt(t)
    hour = dt.hour % 12 or 12
    stamp = f"{dt.strftime('%A, %B %d, %Y')}; {hour}:{dt.minute:02d} {'AM' if dt.hour < 12 else 'PM'}"
    page = re.sub(r"Last Updated:[^<]*", f"Last Updated: {stamp}\n ", page, count=1)
    label = "Zero Report" if t < 0 else "Election Night Report" if t < 720 else "Semi-Official Results"
    page = re.sub(r"(<h1[^>]*>\s*General Election - November 03, 2026\s*<div>\s*)Zero Report", rf"\g<1>{label}", page, count=1)
    return page.encode("utf-8")


# --------------------------------------------------------------------------- RTM pages
SF_TEMPLATE = (HERE / "fixtures" / "rtm_sfelections.html").read_text()
CLARITY_TEMPLATE = json.loads((HERE / "fixtures" / "rtm_clarity_sum.json").read_text())
SM_ROWS = list(__import__("csv").DictReader(open(HERE / "fixtures" / "rtm_sanmateo_zero.csv", encoding="utf-8")))


def clarity_sum(county, t):
    yes, no, done, total = rtm_votes(county, t)
    doc = json.loads(json.dumps(CLARITY_TEMPLATE))
    for c in doc["Contests"]:
        c["TP"], c["PR"] = total, done
        if "RTM" in c["C"]:
            c["V"], c["TV"] = [yes, no], yes + no
    return doc


def sanmateo_csv(t):
    import csv
    import io
    yes, no, done, _ = rtm_votes("San Mateo", t)
    precincts = sorted({r["Precinct_name"] for r in SM_ROWS})
    reported = set(precincts[:done])
    share = {"YES": yes, "NO": no}
    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=list(SM_ROWS[0].keys()), lineterminator="\n")
    w.writeheader()
    # spread each choice's county total evenly over its reporting rows (split precincts have several rows)
    rows_on = {k: [i for i, r in enumerate(SM_ROWS) if r["Precinct_name"] in reported and r["candidate_name"].strip().upper() == k] for k in share}
    for i, r in enumerate(SM_ROWS):
        r = dict(r)
        name = r["candidate_name"].strip().upper()
        r["Reporting_flag"] = "1" if r["Precinct_name"] in reported else "0"
        idx = rows_on.get(name, [])
        if i in idx:
            base, extra = divmod(share[name], len(idx))
            r["total_votes"] = str(base + (extra if i == idx[0] else 0))
        else:
            r["total_votes"] = "0"
        w.writerow(r)
    return out.getvalue().encode()


def sf_page(t):
    yes, no, done, total = rtm_votes("San Francisco", t)
    tot = yes + no
    page = SF_TEMPLATE.replace("{YES}", f"{yes:,}").replace("{NO}", f"{no:,}").replace("{TOTAL}", f"{tot:,}")
    page = page.replace("{YES_PCT}", f"{100 * yes / tot:.2f}" if tot else "0").replace("{NO_PCT}", f"{100 * no / tot:.2f}" if tot else "0")
    return page.replace("0 of 514 (0%)", f"{done} of {total} ({100 * done / total:.0f}%)").encode()


# --------------------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    clock = None
    fault = {"mode": "none"}
    election_id = "262"
    server_version = "MockElectionNight/1.0"

    def log_message(self, fmt, *args):
        if not self.server.quiet:
            super().log_message(fmt, *args)

    def send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def json(self, obj, code=200):
        self.send(code, json.dumps(obj, indent=2).encode(), "application/json")

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        path = u.path.rstrip("/") or "/"

        if path == "/__mock/clock":
            if "set" in q or "speed" in q:
                self.clock.set(q["set"][0] if "set" in q else None, q["speed"][0] if "speed" in q else None)
            return self.json(self.clock.snapshot())
        if path == "/__mock/fault":
            self.fault["mode"] = q.get("mode", ["none"])[0]
            return self.json(self.fault)

        mode = self.fault["mode"]
        t = self.clock.minutes()
        is_data = path.startswith("/returns") or path.startswith("/rovresults")
        if is_data and mode == "500":
            return self.send(500, b'{"message":"Internal server error"}', "application/json")
        if is_data and mode == "garbage":
            return self.send(200, b'{"raceTitle": "Ballot Meas', "application/json")

        if path in ("/returns/ballot-measures", "/returns/ballot-measures/county/alameda"):
            scope = "state" if path == "/returns/ballot-measures" else "alameda"
            doc = sos_measures(scope, t)
            if q.get("f", [""])[0] == "csv":
                return self.send(200, sos_csv(doc), "text/csv")
            return self.json(doc)
        if path == "/returns/governor":
            return self.json(sos_governor("state", t))
        if path == "/returns/governor/county/alameda":
            return self.json([sos_governor("alameda", t)])  # the real county call wraps the contest in a list
        m = re.fullmatch(r"/clarity/CA/(\w+)/(\d+)(?:/(\d+)/json/sum\.json|/current_ver\.txt)", self.path.split("?")[0])
        if m and m.group(1) in CLARITY_NAMES:
            if m.group(3) is None:
                return self.send(200, b"1001", "text/plain; charset=utf-8")
            return self.json(clarity_sum(CLARITY_NAMES[m.group(1)], t))
        if path == "/smcacre/node/3146":
            return self.send(200, b'<html><body><a href="/smcacre/media/9099/download?attachment">Results on CSV</a></body></html>', "text/html")
        if path == "/smcacre/media/9099/download":
            return self.send(200, sanmateo_csv(t), "text/csv; charset=UTF-8")
        if path == "/sfelections/results/20261103/index.html":
            if mode == "sf403":
                return self.send(403, b"<html>403 Forbidden</html>", "text/html")
            return self.send(200, sf_page(t), "text/html; charset=utf-8")
        m = re.fullmatch(r"/rovresults/(\d+)", path)
        if m:
            if m.group(1) != self.election_id:
                return self.send(404, b"Not Found", "text/html")
            return self.send(200, alameda_page(t, m.group(1)), "text/html; charset=UTF-8")
        # the real API answers unknown paths with 403 + empty body
        return self.send(403, b"", "application/json")


def make_server(host="127.0.0.1", port=8765, minutes=-30.0, speed=1.0, election_id="262", quiet=True):
    class H(Handler):
        pass

    H.clock = Clock(minutes, speed)
    H.fault = {"mode": "none"}
    H.election_id = election_id
    srv = ThreadingHTTPServer((host, port), H)
    srv.quiet = quiet
    srv.clock = H.clock
    return srv


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--start", type=float, default=-30.0, help="sim minutes after 8 p.m. (negative = before polls close)")
    ap.add_argument("--speed", type=float, default=1.0, help="sim minutes per real second (0 freezes the clock)")
    ap.add_argument("--election-id", default="262")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    srv = make_server(a.host, a.port, a.start, a.speed, a.election_id, quiet=not a.verbose)
    print(f"mock election night on http://{a.host}:{a.port}  (clock {a.start:+.0f} min, speed x{a.speed})")
    print("  SoS feed : /returns/ballot-measures  /returns/ballot-measures/county/alameda")
    print(f"  Alameda  : /rovresults/{a.election_id}/")
    print("  control  : /__mock/clock?set=240&speed=30   /__mock/fault?mode=500")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
