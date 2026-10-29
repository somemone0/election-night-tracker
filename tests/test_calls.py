import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import calls  # noqa: E402
import mock_server  # noqa: E402
import tracker  # noqa: E402

rows = lambda *pairs: [{"name": n, "votes": v} for n, v in pairs]


class RuleTests(unittest.TestCase):
    def test_one_seat_needs_a_lead_bigger_than_what_is_left(self):
        r = rows(("A", 6000), ("B", 4000))
        self.assertEqual(calls.decide_candidates(r, 1, False, 1999), ["A"])
        self.assertIsNone(calls.decide_candidates(r, 1, False, 2000))   # B could still tie
        self.assertIsNone(calls.decide_candidates(r, 1, False, None))   # no outstanding count: never automatic

    def test_several_seats_compare_last_winner_with_first_loser(self):
        r = rows(("A", 900), ("B", 800), ("C", 500), ("D", 100))
        self.assertEqual(calls.decide_candidates(r, 2, False, 299), ["A", "B"])
        self.assertIsNone(calls.decide_candidates(r, 2, False, 300))

    def test_ranked_choice_needs_a_majority_of_everything_that_could_be_counted(self):
        r = rows(("A", 600), ("B", 300), ("C", 100))
        self.assertEqual(calls.decide_candidates(r, 1, True, 199), ["A"])   # 600 > (1000 + 199) / 2
        self.assertIsNone(calls.decide_candidates(r, 1, True, 200))
        self.assertIsNone(calls.decide_candidates(rows(("A", 480), ("B", 300), ("C", 220)), 1, True, 0))   # RCV rounds decide

    def test_uncontested_is_not_called(self):
        self.assertIsNone(calls.decide_candidates(rows(("A", 5000)), 1, False, 0))
        self.assertIsNone(calls.decide_candidates(rows(("A", 5), ("B", 4)), 2, False, 0))

    def test_measures_against_their_threshold(self):
        self.assertEqual(calls.decide_measure(700, 300, 0.5, 399), "Yes")
        self.assertIsNone(calls.decide_measure(700, 300, 0.5, 400))
        self.assertEqual(calls.decide_measure(300, 700, 0.5, 399), "No")
        two_thirds = calls.threshold("Needs 2/3 majority Yes votes to pass")
        self.assertAlmostEqual(two_thirds, 2 / 3)
        self.assertEqual(calls.decide_measure(650, 350, two_thirds, 0), "No")    # 65% yes fails a 2/3 measure
        self.assertIsNone(calls.decide_measure(660, 340, two_thirds, 30))         # could still reach 690 / 1030 = 67%
        self.assertEqual(calls.threshold("Needs 55.00% majority Yes votes to pass"), 0.55)


def snapshot():
    return {
        "generated_at": "2026-11-04T05:00:00+00:00",
        "meta": {},
        "races": [
            {"group": "city", "title": "Member, City Council, District 4 - Berkeley (RCV)", "kind": "candidate", "rcv": True, "seats": 1,
             "rows": rows(("Igor A. Tregub", 5200), ("Majdi 'Gaith' Abuhamdieh", 4800))},
            {"group": "congress", "cd": 14, "title": "U.S. Representative, 14th Congressional District", "kind": "candidate", "rcv": False, "seats": 1,
             "rows": rows(("A", 90000), ("B", 10000))},
            {"group": "congress", "cd": 12, "title": "U.S. Representative, 12th Congressional District", "kind": "candidate", "rcv": False, "seats": 1,
             "rows": rows(("Lateefah Simon", 90000), ("Jamie Joyce", 10000))},
        ],
        "state_measures": [{"number": "40", "state": {"yes": 4_000_000, "no": 6_000_000}}],
        "headline": {"number": "40", "state": {"yes": 4_000_000, "no": 6_000_000}},
        "rtm": {"complete": False, "rule": "Needs majority Yes votes to pass", "total": {"yes": 900_000, "no": 100_000}},
    }


class ApplyTests(unittest.TestCase):
    def test_decided_desk_and_guards(self):
        snap = calls.Caller().apply(snapshot(), {"alameda": {"Member, City Council, District 4 - Berkeley (RCV)": "Majdi 'Gaith' Abuhamdieh"}},
                                    {"Alameda": 50_000, "California": 1_000_000})
        d4, cd14, cd12 = snap["races"]
        # a desk call stands even when trailing (RCV), but is flagged for the desk
        self.assertEqual(d4["call"], {"winners": ["Majdi 'Gaith' Abuhamdieh"], "how": "desk", "at": "2026-11-04T05:00:00+00:00"})
        self.assertTrue(any("not leading" in w for w in snap["meta"]["calls"]["warnings"]))
        self.assertNotIn("call", cd14)                          # crosses county lines: the page has only part of it
        self.assertFalse(calls.inside_alameda({"group": "county", "category": "State", "title": "Governor"}))
        self.assertFalse(calls.inside_alameda({"group": "county", "category": "Measures", "title": "Measure RTM - Public Transit Revenue Measure District"}))
        self.assertTrue(calls.inside_alameda({"group": "county", "category": "Judicial", "title": "Judge of the Superior Court, Office 5"}))
        self.assertEqual(cd12["call"]["winners"], ["Lateefah Simon"])
        self.assertEqual(cd12["call"]["how"], "decided")
        self.assertEqual(snap["headline"]["state"]["call"]["winners"], ["No"])   # 2M lead, 1M left
        self.assertNotIn("call", snap["rtm"]["total"])            # not all five counties in yet

    def test_bad_desk_calls_are_ignored(self):
        snap = calls.Caller().apply(snapshot(), {"alameda": {"U.S. Representative, 12th Congressional District": "Jamie Joyce",
                                                              "Member, City Council, District 4 - Berkeley (RCV)": "Nobody"}},
                                    {"Alameda": 50_000})
        d4, _, cd12 = snap["races"]
        self.assertNotIn("call", d4)
        self.assertEqual(cd12["call"], {"winners": ["Lateefah Simon"], "how": "decided", "at": "2026-11-04T05:00:00+00:00"})
        ws = " | ".join(snap["meta"]["calls"]["warnings"])
        self.assertIn("not in this race", ws)
        self.assertIn("contradicts the count", ws)

    def test_call_time_is_kept_across_polls(self):
        c = calls.Caller()
        c.apply(snapshot(), {}, {"Alameda": 0})
        later = snapshot()
        later["generated_at"] = "2026-11-05T05:00:00+00:00"
        c.apply(later, {}, {"Alameda": 0})
        self.assertEqual(later["races"][2]["call"]["at"], "2026-11-04T05:00:00+00:00")


class MockElectionTests(unittest.TestCase):
    """The tracker against the mock: nothing decided at poll close, lopsided races decided as the count finishes."""

    @classmethod
    def setUpClass(cls):
        cls.srv = mock_server.make_server(port=0, minutes=0, speed=0)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.tmp = tempfile.TemporaryDirectory()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.tmp.cleanup()

    def poll_at(self, minutes, calls_cfg=None):
        self.srv.clock.set(minutes, 0)
        path = Path(self.tmp.name) / "calls.json"
        path.write_text(json.dumps(calls_cfg or {}))
        tr = tracker.Tracker(self.base, self.base, "262", Path(self.tmp.name) / "out", mock=True,
                             rtm_sources=tracker.mock_rtm_sources(self.base), calls_path=str(path))
        return tr.poll()

    def test_calls_follow_the_count(self):
        night = self.poll_at(0)
        self.assertFalse(any("call" in r for r in night["races"]))
        cd12 = lambda s: next(r for r in s["races"] if r.get("cd") == 12)
        done = self.poll_at(43200)   # certified: nothing outstanding
        self.assertEqual(done["meta"]["calls"]["outstanding"]["Alameda"], 0)
        self.assertEqual(cd12(done)["call"]["winners"], ["Lateefah Simon"])
        self.assertIn("call", done["headline"]["state"])
        self.assertIn("call", done["rtm"]["total"])
        for r in done["races"]:   # a decided race always names the current leaders
            if r.get("call", {}).get("how") == "decided" and r["kind"] != "measure":
                self.assertEqual(r["call"]["winners"], [x["name"] for x in r["rows"][: r["seats"]]])

    def test_mock_keeps_serving_after_certification(self):
        snap = self.poll_at(50040)   # past 30 days: counts stay at their final numbers
        self.assertEqual(snap["meta"]["errors"], [])
        self.assertEqual(snap["rtm"]["counties_in"], 5)

    def test_desk_call_on_election_night(self):
        snap = self.poll_at(60, {"alameda": {"U.S. Representative, 12th Congressional District": "Lateefah Simon"}})
        cd12 = next(r for r in snap["races"] if r.get("cd") == 12)
        self.assertEqual(cd12["call"]["how"], "desk")

    def test_broken_calls_file_is_reported(self):
        self.srv.clock.set(60, 0)
        path = Path(self.tmp.name) / "broken.json"
        path.write_text("{not json")
        tr = tracker.Tracker(self.base, self.base, "262", Path(self.tmp.name) / "out2", mock=True,
                             rtm_sources=tracker.mock_rtm_sources(self.base), calls_path=str(path))
        snap = tr.poll()
        self.assertTrue(any(e["source"] == "calls" for e in snap["meta"]["errors"]))


if __name__ == "__main__":
    unittest.main()
