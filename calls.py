"""Race calls: which races are over, and who won.

A race is called one of two ways:

  desk      an editor's call, typed into calls.json. This is how races get called on election night, and the only way
            to call a ranked-choice race whose leader is short of a majority (the county's RCV rounds decide those).
  decided   automatic, and only when it is certain: the trailing side could not catch up even if every ballot still
            to be counted went its way. "Still to be counted" is the count of outstanding ballots for the whole
            county (or state), from calls.json (registrars publish unprocessed-ballot reports) or, in mock mode, from
            the mock server. A district race is held to the county-wide number, which is safe but slow: California
            counts for weeks, so most races are decided days after election night. With no outstanding count for a
            place, nothing there is decided automatically.

Rules for "decided" (remaining = outstanding ballots, each of which can add at most one vote to any one choice):
  * one seat, or several seats without ranked choice: the last winning spot leads the first losing spot by more
    than remaining;
  * ranked choice, one seat: the leader has more than half of (counted + remaining) first choices;
  * measure: Yes is above the passing threshold even if every remaining ballot votes No (passes), or below it even
    if every remaining ballot votes Yes (fails);
  * uncontested races (no more candidates than seats) are shown as unopposed, not called;
  * from the county page, only races entirely inside Alameda County are called: city, council and county races, local
    measures, Superior Court seats, and House districts wholly in the county. Statewide offices, appeals-court
    retention votes and Measure RTM also appear there, but with only Alameda's share of the vote, so they are skipped
    (RTM is called from the five-county total, statewide races from the state feed).

A desk call that names someone not in the race is ignored; one that contradicts a "decided" result is ignored in favor
of the count; one for a candidate who is not currently leading is kept (ranked-choice rounds can do that) but flagged.
Flags go to the tracker's console (meta.calls.warnings), not to the page.

calls.json (every part optional):
  {"outstanding": {"Alameda": 120000, "California": 3900000, "Contra Costa": 61000, "San Francisco": 40000,
                   "San Mateo": 22000, "Santa Clara": 95000},
   "state":   {"Prop 40": "No", "Governor": "Xavier Becerra"},
   "alameda": {"Member, City Council, District 4 - Berkeley (RCV)": "Igor A. Tregub",
               "School Directors - Berkeley": ["First Winner", "Second Winner", "Third Winner"]},
   "rtm": "Yes"}
Race names under "alameda" are the titles exactly as the county's results page prints them.
"""
import re

RTM_COUNTIES = ["Alameda", "Contra Costa", "San Francisco", "San Mateo", "Santa Clara"]
WHOLE_DISTRICTS = {12}   # congressional districts entirely inside Alameda County
RTM_RE = re.compile(r"\bRTM\b|REGIONAL TRANSIT", re.I)


def inside_alameda(r):
    """True when the county page has the whole race (not just Alameda's share of a wider one)."""
    if r["group"] == "city":
        return True
    if r["group"] == "congress":
        return r.get("cd") in WHOLE_DISTRICTS
    if r["group"] != "county" or RTM_RE.search(r["title"]):
        return False
    if r.get("category") == "Judicial":
        return "Superior Court" in r["title"]
    return r.get("category") not in ("State", "Federal")


def threshold(rule):
    """Share of Yes votes a measure needs, from the county's wording ("Needs 2/3 majority Yes votes to pass")."""
    if rule and re.search(r"two[- ]thirds|2/3|66(\.\d+)?\s*%", rule, re.I):
        return 2 / 3
    m = re.search(r"(\d+(?:\.\d+)?)\s*%", rule or "")
    return float(m.group(1)) / 100 if m else 0.5


def decide_candidates(rows, seats, rcv, remaining):
    """Winners if the outcome is certain, else None. rows are sorted by votes, highest first."""
    if remaining is None or len(rows) <= seats:
        return None
    total = sum(r["votes"] for r in rows)
    if not total:
        return None
    if rcv:
        if seats != 1:
            return None
        return [rows[0]["name"]] if 2 * rows[0]["votes"] > total + remaining else None
    gap = rows[seats - 1]["votes"] - rows[seats]["votes"]
    return [r["name"] for r in rows[:seats]] if gap > remaining else None


def decide_measure(yes, no, need, remaining):
    """"Yes" (passes) or "No" (fails) if certain, else None."""
    if remaining is None or not yes + no:
        return None
    most = yes + no + remaining
    if yes > need * most:
        return "Yes"
    if yes + remaining < need * most:
        return "No"
    return None


def leading(rows, seats):
    return [r["name"] for r in rows[:seats]] if sum(r["votes"] for r in rows) else []


def measure_leader(m):
    return ["Yes"] if m["yes"] > m["no"] else ["No"] if m["no"] > m["yes"] else []


class Caller:
    """Applies calls to a snapshot. Remembers when each call was first made, so the time does not move each poll."""

    def __init__(self):
        self.first_seen = {}

    def apply(self, snap, cfg, outstanding=None, now=None):
        cfg = cfg or {}
        out = {**(outstanding or {}), **(cfg.get("outstanding") or {})}   # editors' numbers win over the mock's
        warn = []
        now = now or snap["generated_at"]

        def call(target, key, auto, desk, choices, lead):
            picked = None
            if desk:
                names = [desk] if isinstance(desk, str) else list(desk)
                canon = {c.lower(): c for c in choices}
                bad = [n for n in names if str(n).lower() not in canon]
                if bad:
                    warn.append(f"{key}: desk call names {bad}, who are not in this race; ignored")
                else:
                    picked = [canon[str(n).lower()] for n in names]
                    if auto and set(auto) != set(picked):
                        warn.append(f"{key}: desk call {picked} contradicts the count ({auto} cannot lose); using the count")
                        picked = None
                    elif lead and not set(picked) <= set(lead):
                        warn.append(f"{key}: desk call {picked} is not leading the current count ({lead})")
            winners, how = (picked, "desk") if picked else (auto, "decided") if auto else (None, None)
            if not winners:
                return
            at = self.first_seen.setdefault((key, tuple(winners)), now)
            target["call"] = {"winners": winners, "how": how, "at": at}

        # Alameda County's page: city, district, county and House races
        ala, desk_a = out.get("Alameda"), cfg.get("alameda") or {}
        for r in snap.get("races", []):
            if not inside_alameda(r):
                continue
            if r["kind"] == "measure":
                auto = decide_measure(r["yes"], r["no"], threshold(r.get("rule")), ala)
                call(r, f"alameda:{r['title']}", auto and [auto], desk_a.get(r["title"]), ["Yes", "No"], measure_leader(r))
            else:
                seats = r.get("seats") or 1
                auto = decide_candidates(r["rows"], seats, r.get("rcv"), ala)
                call(r, f"alameda:{r['title']}", auto, desk_a.get(r["title"]), [x["name"] for x in r["rows"]], leading(r["rows"], seats))

        # statewide: Prop 40 and the other propositions, governor
        ca, desk_s = out.get("California"), cfg.get("state") or {}
        props = {m["number"]: m["state"] for m in snap.get("state_measures", [])}
        h = snap.get("headline") or {}
        if "state" in h:
            props.setdefault(h["number"], h["state"])
        for number, m in props.items():
            auto = decide_measure(m["yes"], m["no"], 0.5, ca)
            call(m, f"state:Prop {number}", auto and [auto], desk_s.get(f"Prop {number}"), ["Yes", "No"], measure_leader(m))
        if "state" in h and "call" in props.get(h["number"], {}):
            h["state"]["call"] = props[h["number"]]["call"]
        gov = ((snap.get("contests") or {}).get("governor") or {}).get("state")
        if gov:
            rows = gov["candidates"]
            call(gov, "state:Governor", decide_candidates(rows, 1, False, ca), desk_s.get("Governor"), [c["name"] for c in rows], leading(rows, 1))

        # Measure RTM: the five-county total
        r = snap.get("rtm")
        if r:
            rem = [out.get(c) for c in RTM_COUNTIES]
            remaining = sum(rem) if r.get("complete") and None not in rem else None
            t = r["total"]
            auto = decide_measure(t["yes"], t["no"], threshold(r.get("rule")), remaining)
            call(t, "rtm:Measure RTM", auto and [auto], cfg.get("rtm"), ["Yes", "No"], measure_leader(t))

        snap["meta"]["calls"] = {"outstanding": out, "warnings": warn}
        return snap
