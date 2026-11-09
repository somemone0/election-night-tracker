"""The Google Sheet link (sheet.py), against a fake Apps Script that follows tools/sheet/Code.gs's rules and answers
POSTs the way Google does (a redirect to the result)."""
import copy
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sheet  # noqa: E402
import tracker  # noqa: E402


def snapshot(d1=(500, 400), yes_no=(300, 200), prop=(1000, 900)):
    s = {
        "meta": {},
        "races": [
            {"id": "r0", "group": "city", "city": "Berkeley", "title": "City Council, District 1", "kind": "candidate",
             "rows": [{"name": "Ann", "votes": d1[0], "pct": 0}, {"name": "Bo", "votes": d1[1], "pct": 0}], "total": sum(d1)},
            {"id": "r1", "group": "city", "city": "Berkeley", "title": "Measure V - City of Berkeley", "kind": "measure", "total": 0,
             **tracker.measure_summary(*yes_no)},
            {"id": "r2", "group": "city", "city": "Oakland", "title": "Mayor", "kind": "candidate", "rows": [{"name": "Z", "votes": 9, "pct": 100}], "total": 9},
        ],
        "state_measures": [{"number": "40", "name": "Tax", "state": {k: v for k, v in tracker.measure_summary(*prop).items() if k != "total"}}],
        "headline": {"number": "40"},
    }
    s["headline"]["state"] = dict(s["state_measures"][0]["state"])
    return s


class FakeScript:
    """Code.gs in Python: a Drops list of rows, _feed, _pending, and a clock in ms."""
    def __init__(self):
        self.keys, self.rows, self.feed, self.pending, self.now = [], [], {}, {}, 1_000_000

    def post(self, body):
        vals = body["values"]
        self.keys += [k for k in vals if k not in self.keys]
        changed = [k for k in vals if str(self.feed.get(k)) != str(vals[k])]
        if changed:
            prev = self.rows[-1] if self.rows else {}
            self.rows.append({k: vals.get(k, "") if (k in changed or prev.get(k) in ("", None)) else prev[k] for k in self.keys})
            self.feed = dict(vals)
            for k in changed:
                self.pending.pop(k, None)
        return {"values": dict(self.rows[-1]) if self.rows else {}, "pending": copy.deepcopy(self.pending), "now": self.now}

    def edit(self, key, value):   # a hand edit in the last row
        before = self.pending[key]["before"] if key in self.pending else self.rows[-1][key]
        self.rows[-1][key] = value
        self.pending[key] = {"before": before, "at": self.now}


class Pieces(unittest.TestCase):
    def test_counts_cover_only_what_the_page_shows(self):
        c = sheet.counts(snapshot())
        self.assertIn("race:City Council, District 1:Ann", c)
        self.assertIn("race:Measure V - City of Berkeley:Yes", c)
        self.assertIn("prop:40:No", c)
        self.assertFalse(any("Mayor" in k for k in c))   # Oakland is not on the page

    def test_apply_recomputes_shares_leaders_and_the_headline(self):
        s = snapshot()
        changed = sheet.apply(s, {"race:City Council, District 1:Bo": 600, "prop:40:Yes": 800, "race:Measure V - City of Berkeley:No": 300})
        self.assertEqual(len(changed), 3)
        d1 = s["races"][0]
        self.assertEqual([r["name"] for r in d1["rows"]], ["Bo", "Ann"])
        self.assertEqual(d1["total"], 1100)
        self.assertAlmostEqual(d1["rows"][0]["pct"], 54.55, places=2)
        self.assertEqual(s["races"][1]["leader"], "tied")
        self.assertEqual(s["races"][1]["total"], 600)
        self.assertEqual(s["headline"]["state"]["leader"], "no")
        self.assertEqual(s["state_measures"][0]["state"]["yes"], 800)

    def test_same_values_change_nothing(self):
        s = snapshot()
        self.assertEqual(sheet.apply(s, {k: v[1] for k, v in sheet.counts(s).items()}), [])

    def test_cells(self):
        self.assertEqual([sheet.to_int(v) for v in (12, "1,234", 5.0, " 7 ", "abc", -1, 2.5, None, True)], [12, 1234, 5, 7, None, None, None, None, None])


class Flow(unittest.TestCase):
    """Edits wait out the hold; an edit changed again, or overtaken by a drop, is never shown."""
    def setUp(self):
        self.script = FakeScript()
        self.link = sheet.Sheet("x", "s", hold=300, poster=lambda url, secret, body: self.script.post(body))

    def shown(self, snap):
        self.link.sync(snap)
        return snap["races"][0]["rows"][0]["votes"] if snap["races"][0]["rows"][0]["name"] == "Ann" else snap["races"][0]["rows"][1]["votes"]

    def test_drops_are_rows(self):
        self.link.sync(snapshot())
        self.link.sync(snapshot())                   # nothing moved: no new row
        self.link.sync(snapshot(d1=(520, 400)))
        self.assertEqual(len(self.script.rows), 2)
        self.assertEqual(self.script.rows[-1]["race:City Council, District 1:Ann"], 520)

    def test_edit_waits_five_minutes(self):
        key = "race:City Council, District 1:Ann"
        self.link.sync(snapshot())
        self.script.edit(key, 450)
        self.script.now += 299_000
        self.assertEqual(self.shown(snapshot()), 500)
        self.script.now += 2_000
        s = snapshot()
        self.assertEqual(self.shown(s), 450)
        self.assertEqual(s["meta"]["sheet"]["edits"], 1)

    def test_edit_changed_again_shows_only_the_last(self):
        key = "race:City Council, District 1:Ann"
        self.link.sync(snapshot())
        self.script.edit(key, 450)
        self.script.now += 240_000
        self.script.edit(key, 460)                   # restarts the clock; 450 never shows
        self.script.now += 120_000
        self.assertEqual(self.shown(snapshot()), 500)
        self.script.now += 200_000
        self.assertEqual(self.shown(snapshot()), 460)

    def test_edit_carries_forward_until_its_count_moves(self):
        key = "race:City Council, District 1:Ann"
        self.link.sync(snapshot())
        self.script.edit(key, 450)
        self.script.now += 400_000
        self.assertEqual(self.shown(snapshot(prop=(1100, 900))), 450)   # a drop elsewhere keeps the edit
        self.assertEqual(self.shown(snapshot(d1=(530, 410))), 530)      # its own count moved: the feed wins

    def test_edit_overtaken_by_a_drop_is_never_shown(self):
        key = "race:City Council, District 1:Ann"
        self.link.sync(snapshot())
        self.script.edit(key, 450)
        self.script.now += 60_000
        self.assertEqual(self.shown(snapshot(d1=(530, 410))), 530)
        self.script.now += 600_000
        self.assertEqual(self.shown(snapshot(d1=(530, 410))), 530)

    def test_unreachable_sheet_keeps_edits_but_not_over_new_counts(self):
        key = "race:City Council, District 1:Ann"
        self.link.sync(snapshot())
        self.script.edit(key, 450)
        self.script.now += 400_000
        self.link.sync(snapshot())
        def down(*_):
            raise OSError("timed out")
        self.link.post = down
        s = snapshot()
        self.assertEqual(self.shown(s), 450)
        self.assertTrue(s["meta"]["sheet"]["stale"])
        self.assertEqual(self.shown(snapshot(d1=(530, 410))), 530)


class OverHttp(unittest.TestCase):
    """post() follows Apps Script's redirect and checks the secret."""
    @classmethod
    def setUpClass(cls):
        script, result = FakeScript(), {}

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                result["r"] = script.post(body) if body.get("secret") == "s3" else {"error": "bad secret"}
                self.send_response(302)
                self.send_header("Location", "/echo")
                self.end_headers()

            def do_GET(self):
                data = json.dumps(result.get("r", {})).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(data)

        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_address[1]}/exec"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def test_round_trip(self):
        r = sheet.post(self.url, "s3", {"values": {"rtm:Yes": 5}, "labels": {}})
        self.assertEqual(r["values"], {"rtm:Yes": 5})

    def test_bad_secret(self):
        with self.assertRaises(RuntimeError):
            sheet.post(self.url, "nope", {"values": {}, "labels": {}})


if __name__ == "__main__":
    unittest.main()
