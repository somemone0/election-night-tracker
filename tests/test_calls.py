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


def ap_call(*names, at="2026-11-04T07:42:00Z"):
    return {"winners": list(names), "at": at}


class ApplyTests(unittest.TestCase):
    def test_no_automatic_calls_and_legacy_desk_calls_ignored(self):
        snap = calls.Caller().apply(snapshot(), {"outstanding": {"Alameda": 0, "California": 0},
            "state": {"Prop 40": "No"}})
        self.assertFalse(any("call" in r for r in snap["races"]))
        self.assertNotIn("call", snap["headline"]["state"])
        self.assertNotIn("call", snap["rtm"]["total"])
        self.assertTrue(snap["meta"]["calls"]["warnings"])

    def test_ap_calls_override_count_without_predicting_other_races(self):
        snap = snapshot()
        title = snap["races"][0]["title"]
        calls.Caller().apply(snap, {"source": "AP", "alameda": {title: ap_call("Majdi 'Gaith' Abuhamdieh")},
            "state": {"Prop 40": ap_call("Yes")}, "rtm": ap_call("No")})
        self.assertEqual(snap["races"][0]["call"], {
            "winners": ["Majdi 'Gaith' Abuhamdieh"], "how": "ap", "at": "2026-11-04T07:42:00Z"})
        self.assertNotIn("call", snap["races"][2])
        self.assertEqual(snap["headline"]["state"]["call"], snap["state_measures"][0]["state"]["call"])
        self.assertEqual(snap["rtm"]["total"]["call"]["winners"], ["No"])
        self.assertEqual(snap["meta"]["calls"]["warnings"], [])

    def test_invalid_entries_do_not_produce_calls(self):
        title = snapshot()["races"][2]["title"]
        for entry in ["Lateefah Simon", ap_call("Nobody"), ap_call(),
                      ap_call("Lateefah Simon", "Jamie Joyce"), ap_call("Lateefah Simon", "Lateefah Simon"),
                      ap_call("Lateefah Simon", at="bad"), ap_call("Lateefah Simon", at="2026-11-04T07:42:00")]:
            with self.subTest(entry=entry):
                snap = calls.Caller().apply(snapshot(), {"source": "AP", "alameda": {title: entry}})
                self.assertNotIn("call", snap["races"][2])
                self.assertTrue(snap["meta"]["calls"]["warnings"])

    def test_retractions_clear_existing_calls(self):
        c, snap = calls.Caller(), snapshot()
        cfg = {"source": "AP", "state": {"Prop 40": ap_call("No")}}
        c.apply(snap, cfg)
        self.assertIn("call", snap["headline"]["state"])
        c.apply(snap, {"source": "AP"})
        self.assertNotIn("call", snap["headline"]["state"])
        self.assertNotIn("call", snap["state_measures"][0]["state"])

    def test_partial_multiseat_calls_and_governor(self):
        snap = snapshot()
        snap["races"][0].update(seats=2)
        snap["contests"] = {"governor": {"state": {"candidates": rows(("A", 10), ("B", 5))}}}
        calls.Caller().apply(snap, {"source": "AP",
            "alameda": {snap["races"][0]["title"]: ap_call("Igor A. Tregub")},
            "state": {"Governor": ap_call("B")}})
        self.assertEqual(snap["races"][0]["call"]["winners"], ["Igor A. Tregub"])
        self.assertEqual(snap["contests"]["governor"]["state"]["call"]["winners"], ["B"])


class MockElectionTests(unittest.TestCase):
    """Mock counts never produce calls; AP-verified entries do."""

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

    def test_mock_never_calls_races_even_after_counting_finishes(self):
        for minutes in [0, 43200]:
            snap = self.poll_at(minutes)
            self.assertFalse(any("call" in r for r in snap["races"]))
            self.assertNotIn("call", snap["headline"]["state"])
            self.assertNotIn("call", snap["rtm"]["total"])

    def test_mock_keeps_serving_after_certification(self):
        snap = self.poll_at(50040)   # past 30 days: counts stay at their final numbers
        self.assertEqual(snap["meta"]["errors"], [])
        self.assertEqual(snap["rtm"]["counties_in"], 5)

    def test_ap_call_on_election_night(self):
        snap = self.poll_at(60, {"source": "AP", "alameda": {"U.S. Representative, 12th Congressional District": ap_call("Lateefah Simon")}})
        cd12 = next(r for r in snap["races"] if r.get("cd") == 12)
        self.assertEqual(cd12["call"]["how"], "ap")

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
