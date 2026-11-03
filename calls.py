"""Display AP calls transcribed by editors into calls.json; never predict winners.

The config must explicitly declare source "AP". Each entry has winners (a list
of exact candidate names, or ["Yes"]/["No"]) and at (AP's ISO 8601 call time
with a timezone). Legacy desk calls and outstanding-ballot counts are ignored.
Removing an entry removes its call on the next poll.
"""
from datetime import datetime
import re

WHOLE_DISTRICTS = {12}
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


class Caller:
    """Attach only explicitly AP-sourced calls, independently of vote totals."""

    def apply(self, snap, cfg):
        cfg = cfg or {}
        warnings = []

        # Clear calls if this snapshot is reused, including withdrawn AP calls.
        def clear(value):
            if isinstance(value, dict):
                value.pop("call", None)
                for child in value.values():
                    clear(child)
            elif isinstance(value, list):
                for child in value:
                    clear(child)
        clear(snap)

        if cfg and cfg.get("source") != "AP":
            warnings.append('Calls ignored: calls.json must explicitly declare source "AP"; legacy desk calls are unsupported')
            cfg = {}

        def call(target, key, entry, choices, seats=1):
            if entry is None:
                return
            if not isinstance(entry, dict):
                warnings.append(f"{key}: AP call must contain winners and at; ignored")
                return
            names, at = entry.get("winners"), entry.get("at")
            canon = {c.casefold(): c for c in choices}
            if (not isinstance(names, list) or not names or len(names) > seats
                    or any(not isinstance(n, str) or n.casefold() not in canon for n in names)
                    or len({n.casefold() for n in names}) != len(names)):
                warnings.append(f"{key}: invalid AP winners or too many winners for the seats; ignored")
                return
            try:
                when = datetime.fromisoformat(at.replace("Z", "+00:00")) if isinstance(at, str) else None
                if when is None or when.tzinfo is None:
                    raise ValueError("missing timezone")
            except ValueError:
                warnings.append(f"{key}: AP call needs an ISO 8601 at time with timezone; ignored")
                return
            target["call"] = {"winners": [canon[n.casefold()] for n in names], "how": "ap", "at": at}

        local = cfg.get("alameda") or {}
        for r in snap.get("races", []):
            if not inside_alameda(r):
                continue
            choices = ["Yes", "No"] if r["kind"] == "measure" else [row["name"] for row in r["rows"]]
            call(r, f"alameda:{r['title']}", local.get(r["title"]), choices,
                 1 if r["kind"] == "measure" else r.get("seats") or 1)

        state = cfg.get("state") or {}
        for m in snap.get("state_measures", []):
            call(m["state"], f"state:Prop {m['number']}", state.get(f"Prop {m['number']}"), ["Yes", "No"])
        headline = snap.get("headline") or {}
        if "state" in headline:
            call(headline["state"], f"state:Prop {headline['number']}", state.get(f"Prop {headline['number']}"), ["Yes", "No"])
        gov = ((snap.get("contests") or {}).get("governor") or {}).get("state")
        if gov:
            call(gov, "state:Governor", state.get("Governor"), [c["name"] for c in gov["candidates"]])
        rtm = snap.get("rtm")
        if rtm:
            call(rtm["total"], "rtm:Measure RTM", cfg.get("rtm"), ["Yes", "No"])

        snap["meta"]["calls"] = {"source": "AP", "warnings": warnings}
        return snap
