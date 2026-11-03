"""Google Sheet link: the vote counts the page shows, one row per ballot drop, editable by the desk.

Every poll the tracker posts its vote counts to an Apps Script attached to the sheet (tools/sheet/Code.gs). When any
count moved since the last post, the script adds a row (a "drop") to the Drops tab: the new counts, and the previous
row's values for everything that did not move, so hand edits carry forward until the count they cover moves.

The script answers with the last row and the hand edits still on hold. An edit goes on screen once it has stood for
HOLD seconds (5 minutes); until then the page keeps the value from before the edit. An edit changed again restarts
the clock, so the in-between value is never shown, and an edit whose count moves in a new drop is never shown.

Keys (row 2 of the sheet, hidden) name a count: race:<Alameda race title>:<candidate or Yes/No>,
rtm:<Yes/No> (the five-county total), prop:<number>:<Yes/No> (statewide), gov:<candidate> (statewide).

After each poll the tracker also writes what the page reads (results.json and the end of history.json) to the Page
tab, so the page can be hosted anywhere and read the sheet instead of the tracker (README, "Hosting on
data.dailycal.org").
"""
import json
import urllib.request

HOLD = 300
PAGE_HISTORY = 300   # history points sent to the page: hours of election night at one per Secretary of State update
CHUNK = 40000        # a sheet cell holds 50,000 characters
USER_AGENT = "election-tracker/1.0 (newsroom results tracker)"


def _measure(m, yes, no):
    total = yes + no
    yp = round(100 * yes / total, 2) if total else 0.0
    np_ = round(100 * no / total, 2) if total else 0.0
    m.update(yes=yes, no=no, yes_pct=yp, no_pct=np_, margin=round(abs(yp - np_), 2),
             leader=None if not total else "tied" if yes == no else ("yes" if yes > no else "no"))
    if "total" in m:
        m["total"] = total


def _candidates(rows):
    total = sum(r["votes"] for r in rows)
    for r in rows:
        r["pct"] = round(100 * r["votes"] / total, 2) if total else 0.0
    rows.sort(key=lambda r: -r["votes"])
    return total


def counts(snap):
    """-> {key: [label, votes]} for every count on the page that comes from a feed."""
    out = {}
    for r in snap.get("races", []):
        shown = r.get("city") == "Berkeley" or r["group"] == "congress" or (r["group"] == "county" and r.get("category") == "Measures")
        if not shown:
            continue
        if r["kind"] == "measure":
            for side in ("Yes", "No"):
                out[f"race:{r['title']}:{side}"] = [f"{r['title']} · {side}", r[side.lower()]]
        else:
            for x in r["rows"]:
                out[f"race:{r['title']}:{x['name']}"] = [f"{r['title']} · {x['name']}", x["votes"]]
    rtm = (snap.get("rtm") or {}).get("total")
    if rtm:
        for side in ("Yes", "No"):
            out[f"rtm:{side}"] = [f"Measure RTM, five counties · {side}", rtm[side.lower()]]
    for m in snap.get("state_measures", []):
        for side in ("Yes", "No"):
            out[f"prop:{m['number']}:{side}"] = [f"Prop {m['number']}, statewide · {side}", m["state"][side.lower()]]
    gov = ((snap.get("contests") or {}).get("governor") or {}).get("state")
    if gov:
        for c in gov["candidates"]:
            out[f"gov:{c['name']}"] = [f"Governor, statewide · {c['name']}", c["votes"]]
    return out


def to_int(v):
    """A count from a sheet cell: 1234, "1,234", 1234.0. None if it isn't one."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(v) if v >= 0 and v == int(v) else None
    s = str(v or "").replace(",", "").strip()
    return int(s) if s.isdigit() else None


def shown_values(resp, hold=HOLD):
    """The sheet's answer -> {key: votes} to show: the last row, except edits still on hold show what was there before."""
    now = resp.get("now") or 0
    out = {}
    for key, val in (resp.get("values") or {}).items():
        p = (resp.get("pending") or {}).get(key)
        if p and now - (p.get("at") or 0) < hold * 1000:
            val = p.get("before")   # None/blank: unknown, so the feed's count is shown
        n = to_int(val)
        if n is not None:
            out[key] = n
    return out


def apply(snap, values):
    """Put the sheet's counts into the snapshot where they differ from the feed; recompute shares and leaders.
    -> the keys that were changed."""
    feed = counts(snap)
    diff = {k: v for k, v in values.items() if k in feed and feed[k][1] != v}
    if not diff:
        return []
    for r in snap.get("races", []):
        if r["kind"] == "measure":
            y, n = diff.get(f"race:{r['title']}:Yes"), diff.get(f"race:{r['title']}:No")
            if y is not None or n is not None:
                _measure(r, r["yes"] if y is None else y, r["no"] if n is None else n)
        elif any(f"race:{r['title']}:{x['name']}" in diff for x in r.get("rows", [])):
            for x in r["rows"]:
                x["votes"] = diff.get(f"race:{r['title']}:{x['name']}", x["votes"])
            r["total"] = _candidates(r["rows"])
    rtm = (snap.get("rtm") or {}).get("total")
    if rtm and ("rtm:Yes" in diff or "rtm:No" in diff):
        _measure(rtm, diff.get("rtm:Yes", rtm["yes"]), diff.get("rtm:No", rtm["no"]))
    h = snap.get("headline") or {}
    for m in snap.get("state_measures", []):
        y, n = diff.get(f"prop:{m['number']}:Yes"), diff.get(f"prop:{m['number']}:No")
        if y is None and n is None:
            continue
        y, n = m["state"]["yes"] if y is None else y, m["state"]["no"] if n is None else n
        _measure(m["state"], y, n)
        if m["number"] == h.get("number") and h.get("state"):
            _measure(h["state"], y, n)
    gov = ((snap.get("contests") or {}).get("governor") or {}).get("state")
    if gov and any(f"gov:{c['name']}" in diff for c in gov["candidates"]):
        for c in gov["candidates"]:
            c["votes"] = diff.get(f"gov:{c['name']}", c["votes"])
        gov["total"] = _candidates(gov["candidates"])
    return sorted(diff)


def page_rows(snap, history):
    """-> the Page tab: one row per file, [name, chunk, chunk, ...]. Each chunk starts with "~" so the sheet never takes
    one for a formula or a number; the page drops it (web/src/lib/sheetPage.ts)."""
    rows = []
    for name, obj in (("results", snap), ("history", history[-PAGE_HISTORY:])):
        text = json.dumps(obj, separators=(",", ":"))
        rows.append([name] + ["~" + text[i:i + CHUNK] for i in range(0, len(text), CHUNK)])
    return rows


def post(url, secret, payload, timeout=25):
    body = json.dumps({"secret": secret, **payload}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", "User-Agent": USER_AGENT})
    # Apps Script answers a POST with a redirect to the result, which urllib follows as a GET
    with urllib.request.urlopen(req, timeout=timeout) as r:
        resp = json.loads(r.read().decode("utf-8"))
    if resp.get("error"):
        raise RuntimeError(f"sheet: {resp['error']}")
    return resp


class Sheet:
    def __init__(self, url, secret, hold=HOLD, poster=post):
        self.url, self.secret, self.hold, self.post = url, secret, hold, poster
        self.last = None   # the sheet's last answer, used while it can't be reached
        self.sent = {}     # the feed's counts that answer was for

    def sync(self, snap):
        """Send the feed's counts, then show the sheet's. If the sheet can't be reached, its last answer still applies
        to the counts that haven't moved since (a new drop always beats an old sheet)."""
        c = counts(snap)
        feed = {k: v[1] for k, v in c.items()}
        meta = {"ok": False, "stale": False, "edits": 0, "on_hold": 0}
        try:
            self.last = self.post(self.url, self.secret, {"values": feed, "labels": {k: v[0] for k, v in c.items()}})
            self.sent = feed
            meta["ok"] = True
        except Exception as e:
            meta.update(stale=self.last is not None, error=str(e))
        if self.last:
            vals = shown_values(self.last, self.hold)
            if not meta["ok"]:
                vals = {k: v for k, v in vals.items() if k in self.sent and self.sent[k] == feed.get(k)}
            meta["edits"] = len(apply(snap, vals))
            now = self.last.get("now") or 0
            meta["on_hold"] = sum(1 for p in (self.last.get("pending") or {}).values() if now - (p.get("at") or 0) < self.hold * 1000)
        snap["meta"]["sheet"] = meta
        return meta

    def publish(self, snap, history):
        """Write the finished snapshot to the Page tab for the page to read. -> an error message, or None."""
        try:
            self.post(self.url, self.secret, {"page": page_rows(snap, history)})
        except Exception as e:
            return str(e)
        return None
