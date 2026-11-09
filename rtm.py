"""Measure RTM (the Bay Area regional transit sales tax) across the five counties that vote on it.

RTM passes or fails on the combined vote, so the tracker adds up each county's count:

  Alameda        the county results page the tracker already parses
  Contra Costa   Clarity ENR JSON   (set the election URL in rtm_sources.json on election night)
  Santa Clara    Clarity ENR JSON   (same)
  San Mateo      the county's "Results on CSV" export, linked from its results page
  San Francisco  sfelections.org results page; it refuses automated requests, so rtm_manual.json
                 (numbers typed in from the page) is used whenever the page cannot be read

Any county can also be filled from rtm_manual.json, which is only used when the automated source fails.

MTC (the district) posts the combined five-county total on its own page from about 9 p.m. on election night. When
rtm_sources.json has an "MTC" entry with a url and that page shows Yes and No totals, those are used as the total and
the counties are not read. Until it does (or if it breaks), the county-by-county sum above is the fallback.
"""
import csv
import gzip
import io
import json
import re
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

COUNTIES = ["Alameda", "Contra Costa", "San Francisco", "San Mateo", "Santa Clara"]
RTM_RE = re.compile(r"\bRTM\b|REGIONAL TRANSIT", re.I)
RULE = "Needs majority Yes votes to pass"   # district-wide majority; the county pages agree


class NotConfigured(LookupError):
    """No results address set for this county yet (expected before election night)."""


def _int(s):
    s = re.sub(r"[^\d]", "", str(s or ""))
    return int(s) if s else 0


def _json(body):
    try:
        return json.loads(body)
    except ValueError:
        return json.loads(gzip.decompress(body))


def _county(name, yes, no, precincts=None, source=None, status="ok", note=None):
    total = yes + no
    return {
        "county": name, "yes": yes, "no": no,
        "yes_pct": round(100 * yes / total, 2) if total else 0.0,
        "no_pct": round(100 * no / total, 2) if total else 0.0,
        "precincts": precincts, "source": source, "status": status, "note": note,
    }


def _prec(done, total):
    return {"done": done, "total": total, "pct": round(100 * done / total, 2) if total else 0.0} if total else None


# --------------------------------------------------------------------------- sources
def from_alameda(races):
    r = next((r for r in races or [] if RTM_RE.search(r["title"])), None)
    if not r:
        raise LookupError("Measure RTM is not on the Alameda results page")
    return _county("Alameda", r["yes"], r["no"], r.get("precincts"), "Alameda County Registrar of Voters")


def from_clarity(base, fetch):
    """base like https://results.enr.clarityelections.com/CA/Contra_Costa/126374"""
    base = base.rstrip("/")
    ver = fetch(f"{base}/current_ver.txt").decode().strip()
    if not ver.isdigit():
        raise ValueError(f"unexpected Clarity version {ver[:40]!r}")
    data = _json(fetch(f"{base}/{ver}/json/sum.json"))
    c = next((c for c in data.get("Contests", []) if RTM_RE.search(c.get("C", ""))), None)
    if not c:
        raise LookupError("no RTM contest in this Clarity election")
    votes = dict(zip([x.upper() for x in c["CH"]], c["V"]))
    yes = sum(v for k, v in votes.items() if re.search(r"\bYES\b", k))
    no = sum(v for k, v in votes.items() if re.search(r"\bNO\b", k))
    return yes, no, _prec(c.get("PR", 0), c.get("TP", 0))


def from_smcacre(page_url, fetch):
    """San Mateo: find the 'Results on CSV' link on the county's results page, then sum the precinct rows."""
    html = fetch(page_url).decode("utf-8", "replace")
    m = re.search(r'<a[^>]+href="([^"]+)"[^>]*>\s*Results(?:&nbsp;|\s)+on(?:&nbsp;|\s)+CSV\s*</a>', html, re.I)
    if not m:
        raise LookupError("no 'Results on CSV' link on the San Mateo results page")
    body = fetch(urljoin(page_url, m.group(1).replace("&amp;", "&"))).decode("utf-8-sig", "replace")
    return parse_smcacre_csv(body)


def parse_smcacre_csv(text):
    yes = no = 0
    precincts, reported, seen = set(), set(), False
    for row in csv.DictReader(io.StringIO(text)):
        if not RTM_RE.search(row.get("Contest_title", "")):
            continue
        seen = True
        name = (row.get("candidate_name") or "").strip().upper()
        if name == "YES":
            yes += _int(row.get("total_votes"))
        elif name == "NO":
            no += _int(row.get("total_votes"))
        precincts.add(row.get("Precinct_name"))
        if str(row.get("Reporting_flag", "")).strip() == "1":
            reported.add(row.get("Precinct_name"))
    if not seen:
        raise LookupError("no Regional Transit Measure rows in the San Mateo CSV")
    return yes, no, _prec(len(reported), len(precincts))


class _SFParser(HTMLParser):
    """sfelections.org summary: <h4>REGIONAL MEASURE RTM - ...</h4> then a table whose rows start YES / NO."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_h4 = self.in_rtm = self.in_cell = False
        self.buf, self.row, self.rows, self.text = [], [], [], []

    def handle_starttag(self, tag, attrs):
        if tag == "h4":
            self.in_h4, self.buf = True, []
        elif tag in ("td", "th") and self.in_rtm:
            self.in_cell, self.buf = True, []
        elif tag == "tr" and self.in_rtm:
            self.row = []

    def handle_endtag(self, tag):
        if tag == "h4" and self.in_h4:
            self.in_h4 = False
            heading = "".join(self.buf)
            self.in_rtm = bool(RTM_RE.search(heading)) if not self.rows else False   # first RTM table only
        elif tag in ("td", "th") and self.in_cell:
            self.in_cell = False
            self.row.append("".join(self.buf).strip())
        elif tag == "tr" and self.in_rtm and self.row:
            self.rows.append(self.row)
        elif tag == "table" and self.in_rtm:
            self.in_rtm = False

    def handle_data(self, data):
        self.text.append(data)
        if self.in_h4 or self.in_cell:
            self.buf.append(data)


def parse_sfelections(html):
    p = _SFParser()
    p.feed(html)
    got = {r[0].strip().upper(): _int(r[1]) for r in p.rows if len(r) >= 2}
    if "YES" not in got or "NO" not in got:
        raise LookupError("no Measure RTM table on the San Francisco results page")
    m = re.search(r"Precincts that have reported[^:]*:\s*([\d,]+)\s*of\s*([\d,]+)", " ".join(p.text))
    return got["YES"], got["NO"], (_prec(_int(m.group(1)), _int(m.group(2))) if m else None)


def from_sfelections(url, fetch):
    return parse_sfelections(fetch(url).decode("utf-8", "replace"))


def parse_mtc(html):
    """MTC's measure page: an 'Election Results' heading, then text or a table with the Yes and No totals.
    Until results are posted that section is a notice with no Yes/No figures, which raises LookupError."""
    m = re.search(r"<h2[^>]*>\s*Election Results\s*</h2>(.*?)(?=<h2|\Z)", html, re.S | re.I)
    if not m:
        raise LookupError("no 'Election Results' section on the MTC page")
    # The page posts a table: County | Yes | No | Total | % Yes, one row per county and a "Regional Total" row
    cell = lambda c: " ".join(unescape(re.sub(r"<[^>]+>", " ", c)).split())
    for tbl in re.findall(r"<table.*?</table>", m.group(1), re.S | re.I):
        head = [cell(c).lower() for c in re.findall(r"<th[^>]*>(.*?)</th>", tbl, re.S | re.I)]
        if "yes" not in head or "no" not in head:
            continue
        for tr in re.findall(r"<tr.*?</tr>", tbl, re.S | re.I):
            cells = [cell(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S | re.I)]
            if len(cells) == len(head) and re.search(r"regional total", cells[0], re.I):
                yes, no = cells[head.index("yes")], cells[head.index("no")]
                if not (re.search(r"\d", yes) and re.search(r"\d", no)):
                    raise LookupError("MTC has not posted Yes/No totals yet")
                return _int(yes), _int(no), None
    text = " ".join(unescape(re.sub(r"<[^>]+>", " ", m.group(1))).split())
    labels = list(re.finditer(r"\b(yes|no)\b", text, re.I))
    got = {}
    for i, lab in enumerate(labels):   # the first whole number after each label, before the next one (skips 54.3% / 54.3)
        seg = text[lab.end():labels[i + 1].start() if i + 1 < len(labels) else len(text)][:80]
        nums = [t for t in re.findall(r"\d[\d,]*(?:\.\d+)?%?", seg) if not t.endswith("%") and "." not in t]
        if nums:
            got.setdefault(lab.group(1).lower(), _int(nums[0]))
    if "yes" not in got or "no" not in got:
        raise LookupError("MTC has not posted Yes/No totals yet")
    return got["yes"], got["no"], None


def from_mtc(url, fetch):
    return parse_mtc(fetch(url).decode("utf-8", "replace"))


SOURCES = {"clarity": from_clarity, "smcacre": from_smcacre, "sfelections": from_sfelections}
SOURCE_NAMES = {"clarity": "county results (Clarity)", "smcacre": "county CSV export", "sfelections": "SF Department of Elections"}


# --------------------------------------------------------------------------- combine
def load_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return {}


def _total(yes, no):
    total = yes + no
    tot = {"yes": yes, "no": no, "total": total,
           "yes_pct": round(100 * yes / total, 2) if total else 0.0, "no_pct": round(100 * no / total, 2) if total else 0.0,
           "leader": None if not total else "tied" if yes == no else ("yes" if yes > no else "no")}
    tot["margin"] = round(abs(tot["yes_pct"] - tot["no_pct"]), 2)
    return tot


def _district(yes, no):
    """The combined total as MTC reports it: no per-county rows, and it counts as all five counties in."""
    return {"counties": [], "total": _total(yes, no), "rule": RULE, "source": "MTC",
            "counties_in": len(COUNTIES), "counties_counting": len(COUNTIES), "complete": True,
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def collect(alameda_races, fetch, sources, manual):
    """-> {'counties': [...], 'total': {...}, 'counties_in': n, 'counties_counting': n, 'complete': bool, 'rule': ...}"""
    mtc_url = (sources.get("MTC") or {}).get("url")
    if mtc_url:   # the district's own combined total, when it has posted one
        try:
            yes, no, _ = from_mtc(mtc_url, fetch)
            if yes + no > 0:
                return _district(yes, no)
        except Exception:
            pass   # not posted yet, or the page changed: use the counties below
    rows = []
    for name in COUNTIES:
        hand = manual.get(name) if isinstance(manual.get(name), dict) else None
        try:
            if name == "Alameda":
                rows.append(from_alameda(alameda_races))
                continue
            cfg = sources.get(name) or {}
            if not cfg.get("url"):
                raise NotConfigured(cfg.get("note") or "no results address configured yet")
            yes, no, prec = SOURCES[cfg["type"]](cfg["url"], fetch)
            rows.append(_county(name, yes, no, prec, SOURCE_NAMES[cfg["type"]]))
        except Exception as e:   # fall back to hand-entered numbers, else report why the county is missing
            reason = str(e)[:160]
            if hand and "yes" in hand and "no" in hand:
                rows.append(_county(name, _int(hand["yes"]), _int(hand["no"]),
                                    _prec(_int(hand.get("precincts_done")), _int(hand.get("precincts_total"))),
                                    "entered by hand", "manual", f"as of {hand.get('as_of', 'unknown time')}"))
            else:
                rows.append(_county(name, 0, 0, None, None, "waiting" if isinstance(e, NotConfigured) else "error", reason))
    have = [r for r in rows if r["status"] in ("ok", "manual")]
    tot = _total(sum(r["yes"] for r in have), sum(r["no"] for r in have))
    return {
        "counties": rows, "total": tot, "rule": RULE,
        "counties_in": len(have), "counties_counting": sum(1 for r in have if r["yes"] + r["no"] > 0),
        "complete": len(have) == len(COUNTIES),
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
