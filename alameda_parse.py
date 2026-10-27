"""Parser for the Alameda County Registrar results page (rovresults/<id>/).

The page is server-rendered HTML: category panels (<h2>), city sub-panels
(<h3> inside panel-default-sub), races (racePanelHeading), and results tables.
Statewide propositions are one combined "Propositions" table.
"""
import re
from html.parser import HTMLParser

PRECINCTS_RE = re.compile(
    r"(\d[\d,]*) of (\d[\d,]*) Precincts (?:Partially )?Reported(?: from Vote Centers)?\s*\(([\d.]+)\s*%\s*\)"
)
UPDATED_RE = re.compile(r"Last Updated:\s*([^<]+?)\s*<", re.S)


def to_int(s):
    s = re.sub(r"[^\d]", "", s or "")
    return int(s) if s else 0


def to_pct(s):
    m = re.search(r"[\d.]+", s or "")
    return float(m.group()) if m else 0.0


class _Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.races = []
        self.category = None
        self.subcategory = None
        self._want = None  # which heading text we're collecting
        self._buf = []
        self._div_class = None
        self._race = None
        self._in_prop_table = False
        self._cell = None
        self._row = None
        self._in_tr = False
        self._panel_depth_cat = None

    # -- helpers
    def _finish_race(self):
        if self._race and (self._race["rows"] or self._race["title"] == "Propositions"):
            self.races.append(self._race)
        self._race = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class", "") or ""
        if tag == "div" and "panel-default" in cls.split():
            pid = a.get("id", "")
            if "panel-default-sub" in cls:
                self._want = "sub"
                self._buf = []
            elif pid.startswith("panel") and pid != "panelCty-":
                self._finish_race()
                self.subcategory = None
                self._want = "cat"
                self._buf = []
        elif tag in ("h3", "h4") and "racePanelHeading" in cls:
            self._finish_race()
            self._want = "race"
            self._buf = []
        elif tag == "h2" and self._want == "cat":
            self._buf = []
            self._collecting = "cat"
        elif tag == "h3" and self._want == "sub":
            self._buf = []
            self._collecting = "sub"
        elif tag == "div" and self._race is not None:
            if "reported" in cls and not self._race["reported_text"]:
                self._div_class = "reported"
                self._buf = []
            elif "passing" in cls:
                self._div_class = "passing"
                self._buf = []
            elif "votefor" in cls:
                self._div_class = "votefor"
                self._buf = []
            elif "rcvNote" in cls:
                self._race["rcv"] = True
        elif tag == "div" and "table-responsive-prop" in cls:
            self._in_prop_table = True
        elif tag == "tr" and self._race is not None:
            self._in_tr = True
            self._row = {"th": None, "tds": []}
        elif tag in ("th", "td") and self._in_tr:
            self._cell = tag
            self._buf = []

    def handle_endtag(self, tag):
        if tag == "h2" and getattr(self, "_collecting", None) == "cat":
            self.category = _clean("".join(self._buf))
            self._collecting = None
            self._want = None
        elif tag == "h3" and getattr(self, "_collecting", None) == "sub":
            self.subcategory = _clean("".join(self._buf))
            self._collecting = None
            self._want = None
        elif tag in ("h3", "h4") and self._want == "race":
            title = _clean("".join(self._buf))
            self._race = {
                "category": self.category,
                "subcategory": self.subcategory,
                "title": title,
                "reported_text": "",
                "passing": "",
                "votefor": "",
                "rcv": False,
                "rows": [],
            }
            self._want = None
        elif tag == "div" and self._div_class:
            text = _clean("".join(self._buf))
            if self._div_class == "reported":
                self._race["reported_text"] = text
            else:
                self._race[self._div_class] = text
            self._div_class = None
        elif tag in ("th", "td") and self._in_tr and self._cell == tag:
            text = _clean("".join(self._buf))
            if tag == "th" and self._row["th"] is None and self._row.get("seen_td") is None:
                self._row["th"] = text
            elif tag == "td":
                self._row["seen_td"] = True
                self._row["tds"].append(text)
            self._cell = None
        elif tag == "tr" and self._in_tr:
            self._in_tr = False
            r = self._row
            if r and r["th"] and r["tds"]:
                if self._race["title"] == "Propositions" and len(r["tds"]) >= 4:
                    self._race["rows"].append(
                        {
                            "name": r["th"],
                            "yes": to_int(r["tds"][0]),
                            "yes_pct": to_pct(r["tds"][1]),
                            "no": to_int(r["tds"][2]),
                            "no_pct": to_pct(r["tds"][3]),
                        }
                    )
                elif len(r["tds"]) >= 2:
                    self._race["rows"].append(
                        {"name": r["th"], "votes": to_int(r["tds"][0]), "pct": to_pct(r["tds"][1])}
                    )
            self._row = None

    def handle_data(self, data):
        if self._want in ("race", "cat", "sub") or self._div_class or self._cell:
            self._buf.append(data)

    def close(self):
        super().close()
        self._finish_race()


def _clean(s):
    return re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()


def parse(html):
    """Return {'updated': str, 'title': str, 'races': [...]}.

    Each race has category, subcategory, title, precincts {done,total,pct},
    rows, kind ('measure' when the rows are Yes/No) and rcv.
    Propositions are expanded to one race per proposition (category 'State').
    """
    p = _Parser()
    p.feed(html)
    p.close()

    m = UPDATED_RE.search(html)
    updated = _clean(m.group(1)) if m else None
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.S)
    page_title = _clean(re.sub(r"<[^>]+>", " ", h1.group(1))) if h1 else None

    races = []
    for r in p.races:
        pm = PRECINCTS_RE.search(r["reported_text"] or "")
        prec = None
        if pm:
            prec = {"done": to_int(pm.group(1)), "total": to_int(pm.group(2)), "pct": float(pm.group(3))}
        if r["title"] == "Propositions":
            for row in r["rows"]:
                races.append(
                    {
                        "category": "State",
                        "subcategory": None,
                        "title": row["name"],
                        "precincts": prec,
                        "kind": "measure",
                        "rcv": False,
                        "passing": "Needs majority Yes votes to pass",
                        "rows": [
                            {"name": "Yes", "votes": row["yes"], "pct": row["yes_pct"]},
                            {"name": "No", "votes": row["no"], "pct": row["no_pct"]},
                        ],
                    }
                )
            continue
        names = [x["name"] for x in r["rows"]]
        kind = "measure" if len(names) == 2 and names[0].endswith("Yes") and names[1].endswith("No") else "candidate"
        races.append(
            {
                "category": r["category"],
                "subcategory": r["subcategory"],
                "title": r["title"],
                "precincts": prec,
                "kind": kind,
                "rcv": r["rcv"],
                "passing": r["passing"],
                "rows": r["rows"],
            }
        )
    return {"updated": updated, "title": page_title, "races": races}


if __name__ == "__main__":
    import json
    import sys

    out = parse(open(sys.argv[1], encoding="utf-8", errors="replace").read())
    print(out["title"], "|", out["updated"], "|", len(out["races"]), "races")
    for r in out["races"][:5]:
        print(json.dumps(r)[:200])
