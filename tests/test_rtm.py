import json
import sys
import tempfile
import threading
import unittest
import urllib.request
from functools import partial
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import mock_server  # noqa: E402
import rtm  # noqa: E402
import tracker  # noqa: E402

FIX = Path(__file__).resolve().parents[1] / "fixtures"


class ParserTests(unittest.TestCase):
    def test_sanmateo_csv_zero_report(self):
        yes, no, prec = rtm.parse_smcacre_csv((FIX / "rtm_sanmateo_zero.csv").read_text())
        self.assertEqual((yes, no), (0, 0))
        self.assertEqual(prec["total"], 333)   # the real Nov. 3 zero report

    def test_sf_page(self):
        html = (FIX / "rtm_sfelections.html").read_text().replace("{YES}", "1,234").replace("{NO}", "567").replace("{TOTAL}", "1,801")
        yes, no, prec = rtm.parse_sfelections(html)
        self.assertEqual((yes, no), (1234, 567))   # the RTM table, not Measure A's
        self.assertEqual(prec["total"], 514)

    def test_clarity(self):
        doc = json.loads((FIX / "rtm_clarity_sum.json").read_text())
        doc["Contests"][1]["V"] = [10, 7]
        pages = {"x/current_ver.txt": b"42", "x/42/json/sum.json": json.dumps(doc).encode()}
        self.assertEqual(rtm.from_clarity("x", lambda u: pages[u])[:2], (10, 7))


class CollectTests(unittest.TestCase):
    alameda = [{"title": "Measure RTM - Public Transit Revenue Measure District", "yes": 60, "no": 40, "precincts": None}]

    def test_waiting_error_and_manual(self):
        def fetch(url):
            raise OSError("HTTP Error 403: Forbidden")
        sources = {"Contra Costa": {"type": "clarity", "url": None, "note": "set later"},
                   "San Francisco": {"type": "sfelections", "url": "https://sf.example/x"},
                   "San Mateo": {"type": "smcacre", "url": "https://sm.example/x"}}
        manual = {"San Francisco": {"yes": 30, "no": 10, "as_of": "9:45 p.m."}}
        out = rtm.collect(self.alameda, fetch, sources, manual)
        by = {c["county"]: c for c in out["counties"]}
        self.assertEqual(by["Contra Costa"]["status"], "waiting")
        self.assertEqual(by["San Francisco"]["status"], "manual")
        self.assertEqual(by["San Mateo"]["status"], "error")
        self.assertEqual((out["total"]["yes"], out["total"]["no"]), (90, 50))   # Alameda + hand-entered SF only
        self.assertEqual(out["counties_in"], 2)
        self.assertFalse(out["complete"])


class MockEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = mock_server.make_server(port=0, minutes=300, speed=0)
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def poll(self, manual=None):
        with tempfile.TemporaryDirectory() as d:
            m = Path(d, "manual.json")
            if manual:
                m.write_text(json.dumps(manual))
            tr = tracker.Tracker(self.base, self.base, "262", Path(d), mock=True, rtm_sources=tracker.mock_rtm_sources(self.base), rtm_manual=m)
            return tr.poll()["rtm"]

    def test_all_five_counties_add_up(self):
        r = self.poll()
        self.assertTrue(r["complete"])
        self.assertEqual(r["total"]["yes"], sum(c["yes"] for c in r["counties"]))
        sm = next(c for c in r["counties"] if c["county"] == "San Mateo")
        self.assertEqual((sm["yes"], sm["no"]), mock_server.rtm_votes("San Mateo", 300)[:2])   # CSV rows sum back to the county total

    def test_sf_refusal_falls_back_to_hand_entry(self):
        urllib.request.urlopen(self.base + "/__mock/fault?mode=sf403").read()
        try:
            r = self.poll({"San Francisco": {"yes": 5, "no": 5, "as_of": "now"}})
        finally:
            urllib.request.urlopen(self.base + "/__mock/fault?mode=none").read()
        sf = next(c for c in r["counties"] if c["county"] == "San Francisco")
        self.assertEqual((sf["status"], sf["yes"]), ("manual", 5))
        self.assertTrue(r["complete"])


if __name__ == "__main__":
    unittest.main()
