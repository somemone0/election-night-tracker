import json
import sys
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import alameda_parse  # noqa: E402
import mock_server  # noqa: E402
import tracker  # noqa: E402

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "alameda_zero_report.html"


class MockCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = mock_server.make_server(port=0, minutes=-30, speed=0)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def at(self, minutes):
        self.srv.clock.set(minutes, 0)

    def get(self, path):
        return urllib.request.urlopen(self.base + path).read()


class ParserTests(unittest.TestCase):
    def test_fixture_structure(self):
        out = alameda_parse.parse(FIXTURE.read_text(encoding="utf-8", errors="replace"))
        titles = {r["title"]: r for r in out["races"]}
        self.assertIn("Proposition 40", titles)
        self.assertEqual(titles["Proposition 40"]["kind"], "measure")
        self.assertEqual(titles["Bond Measure U - City of Berkeley"]["kind"], "measure")
        self.assertTrue(titles["Auditor - Berkeley (RCV)"]["rcv"])
        self.assertEqual(titles["Measure V - City of Berkeley"]["precincts"]["total"], 31)
        berkeley = [r for r in out["races"] if "Berkeley" in r["title"]]
        self.assertGreaterEqual(len(berkeley), 14)


class RosterTests(unittest.TestCase):
    def test_placeholder_page_gets_candidate_lists(self):
        placeholder = {"updated": "Thursday, September 17, 2026; 2:53 PM", "title": "Congressional District 14 Special General Election - August 18, 2026 Certified Final Results", "races": []}
        out = tracker.with_roster(placeholder)
        self.assertTrue(out["roster_only"])
        self.assertEqual(out["title"], placeholder["title"])  # warnings still see the placeholder
        berkeley = [r for r in out["races"] if r["city"] == "Berkeley"]
        self.assertGreaterEqual(len(berkeley), 14)
        self.assertTrue(all((r.get("total") or r.get("yes", 0) + r.get("no", 0)) == 0 for r in berkeley))

    def test_real_page_is_left_alone(self):
        real = {"updated": "x", "title": "General Election - November 03, 2026 Election Night Report", "races": [{"title": "t"}]}
        self.assertIs(tracker.with_roster(real), real)


class MockTests(MockCase):
    def test_before_polls_close_is_zero(self):
        self.at(-10)
        doc = json.loads(self.get("/returns/ballot-measures"))
        self.assertTrue(all(m["yesVotes"] == "0" for m in doc["ballot-measures"]))
        self.assertTrue(doc["Reporting"].startswith("0.0%"))

    def test_sos_shape_matches_real_api(self):
        self.at(120)
        doc = json.loads(self.get("/returns/ballot-measures/county/alameda"))
        self.assertEqual(set(doc), {"raceTitle", "Reporting", "ReportingTime", "ballot-measures"})
        m = next(m for m in doc["ballot-measures"] if m["Number"] == "40")
        self.assertEqual(set(m), {"Name", "Number", "yesVotes", "yesPercent", "noVotes", "noPercent"})
        self.assertIsInstance(m["yesVotes"], str)  # the real API sends strings

    def test_csv_is_utf16(self):
        self.at(120)
        text = self.get("/returns/ballot-measures?f=csv").decode("utf-16-le")
        self.assertIn("Ballot Measures - Statewide Results", text)

    def test_sources_agree_for_alameda_prop40(self):
        for t in (0, 75, 400, 3000):
            self.at(t)
            sos = json.loads(self.get("/returns/ballot-measures/county/alameda"))
            page = alameda_parse.parse(self.get("/rovresults/262/").decode())
            a = next(m for m in sos["ballot-measures"] if m["Number"] == "40")
            b = next(r for r in page["races"] if r["title"] == "Proposition 40")
            self.assertEqual((int(a["yesVotes"]), int(a["noVotes"])), (b["rows"][0]["votes"], b["rows"][1]["votes"]), t)

    def test_counts_never_decrease(self):
        for scope, n in (("state", "40"), ("alameda", "40"), ("state", "03")):
            prev = (0, 0, 0)
            for t in range(-30, 43300, 5):
                y, no, d, _ = mock_server.measure_votes(scope, n, t)
                self.assertGreaterEqual((y, no, d), prev, (scope, n, t))
                prev = (y, no, d)

    def test_unknown_path_and_election_id(self):
        with self.assertRaises(urllib.error.HTTPError) as c:
            self.get("/rovresults/999/")
        self.assertEqual(c.exception.code, 404)
        with self.assertRaises(urllib.error.HTTPError) as c:
            self.get("/returns/nonsense")
        self.assertEqual(c.exception.code, 403)


class TrackerTests(MockCase):
    def make(self, out):
        return tracker.Tracker(self.base, self.base, "262", Path(out), mock=True)

    def test_snapshot_and_history(self):
        with tempfile.TemporaryDirectory() as d:
            tr = self.make(d)
            self.at(-10)
            snap = tr.poll()
            self.assertEqual(snap["headline"]["state"]["yes"], 0)
            self.assertFalse(Path(d, "history.json").exists())  # zero report: nothing to chart yet
            self.at(30)
            snap = tr.poll()
            h = snap["headline"]
            self.assertGreater(h["state"]["yes"], 0)
            self.assertTrue(h["alameda_sources_agree"])
            groups = {r["group"] for r in snap["races"]}
            self.assertEqual(groups, {"city", "congress", "county", "turnout"})
            feat = next(r for r in snap["races"] if r["group"] == "congress" and r["cd"] == 12)
            self.assertEqual({x["name"] for x in feat["rows"]}, {"Lateefah Simon", "Jamie Joyce"})
            self.assertEqual(feat["rows"][0]["name"], "Lateefah Simon")
            tr.poll()  # same clock: no duplicate history point
            hist = json.loads(Path(d, "history.json").read_text())
            self.assertEqual(len([p for p in hist if p["sos_time"] == snap["meta"]["sos_state"]["reporting_time"]]), 1)
            self.assertTrue(Path(d, "races.csv").read_text().startswith("group,city,congress,title,choice"))

    def test_city_and_district_tagging(self):
        with tempfile.TemporaryDirectory() as d:
            self.at(60)
            snap = self.make(d).poll()
            cities = {r["city"] for r in snap["races"] if r["group"] == "city"}
            self.assertEqual(cities, set(tracker.CITIES) & cities)
            self.assertIn("Berkeley", cities)
            self.assertGreaterEqual(len(cities), 10)
            self.assertEqual({r["cd"] for r in snap["races"] if r["group"] == "congress"}, {10, 12, 14, 17})
            bm = [r for r in snap["races"] if r["city"] == "Berkeley" and r["kind"] == "measure"]
            self.assertGreaterEqual(len(bm), 7)  # Bond Measure U, V..AA

    def test_governor_agrees_between_feed_and_county_page(self):
        with tempfile.TemporaryDirectory() as d:
            for t in (10, 200, 2000):
                self.at(t)
                snap = self.make(d).poll()
                gov = snap["contests"]["governor"]
                page = next(r for r in snap["races"] if r["title"] == "Governor")
                self.assertEqual({c["name"]: c["votes"] for c in gov["alameda"]["candidates"]}, {x["name"]: x["votes"] for x in page["rows"]})
                self.assertEqual(gov["state"]["candidates"][0]["name"], "Xavier Becerra")

    def test_source_failure_keeps_last_good_data(self):
        with tempfile.TemporaryDirectory() as d:
            tr = self.make(d)
            self.at(60)
            good = tr.poll()
            self.assertEqual(good["meta"]["errors"], [])
            urllib.request.urlopen(self.base + "/__mock/fault?mode=500").read()
            try:
                bad = tr.poll()
            finally:
                urllib.request.urlopen(self.base + "/__mock/fault?mode=none").read()
            self.assertEqual(len(bad["meta"]["errors"]), 5)
            self.assertTrue(all(bad["meta"][k]["stale"] for k in ("sos_state", "sos_alameda", "alameda", "gov_state", "gov_alameda")))
            self.assertEqual(bad["headline"]["state"]["yes"], good["headline"]["state"]["yes"])
            recovered = tr.poll()
            self.assertEqual(recovered["meta"]["errors"], [])

    def test_garbage_json_is_an_error_not_a_crash(self):
        with tempfile.TemporaryDirectory() as d:
            tr = self.make(d)
            self.at(60)
            urllib.request.urlopen(self.base + "/__mock/fault?mode=garbage").read()
            try:
                snap = tr.poll()
            finally:
                urllib.request.urlopen(self.base + "/__mock/fault?mode=none").read()
            self.assertTrue(snap["meta"]["errors"])
            self.assertFalse(snap["meta"]["sos_state"]["ok"])


if __name__ == "__main__":
    unittest.main()
