#!/usr/bin/env python3
"""Control panel for the election-night box: data mode, the Facebook stream, source status, election-night settings.

Serves http://127.0.0.1:8090 only (reach it from a laptop with `ssh -L 8090:127.0.0.1:8090 <box>`).

  data mode   REAL      tracker.py on the live feeds, with the Google Sheet
              MOCK      tracker.py --mock (a simulated election night), no sheet
              ZEROS     tracker.py --mock held before the polls close: every count 0, no sheet
  stream      tools' ~/bin/stream-start.sh / stream-stop.sh (Xvfb + Chrome + ffmpeg to Facebook)
  video       the Xvfb screen the stream captures, as MJPEG
  status      one probe per source we read (SoS, Alameda, MTC, San Mateo, SF, Clarity, Sheet) plus Facebook and the tunnel

The tracker's results page (:8077) is whatever mode is running, so switching mode changes what the stream shows.
Nothing secret is returned by the API: logs are masked, ~/.election-env is only read to start the tracker.
Settings live in ~/.election-control/ (config.json, and the rtm_sources.json / rtm_manual.json the tracker is pointed at),
so the repo's own files stay untouched.
"""
import json
import os
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO))
import rtm  # noqa: E402

HOME = Path.home()
CTL = HOME / ".election-control"
CFG_PATH = CTL / "config.json"
ENV_PATH = HOME / ".election-env"
LOGS = HOME / "logs"
PORT = int(os.environ.get("CONTROL_PORT", "8090"))
TRACKER_PORT = 8077
BROADCAST_URL = f"http://127.0.0.1:{TRACKER_PORT}/broadcast.html"
XDISPLAY = ":99"
SOS, ALA = "https://api.sos.ca.gov", "https://alamedacountyca.gov/rovresults/262/"
UA = "election-tracker/1.0 (control panel probe)"
MOCK_SPEEDS = {"SLOW": 0.02, "MED": 0.3, "FAST": 5.0}   # simulated minutes per real second

DEFAULTS = {"mode": "REAL", "poll_interval": 60, "mock_speed": "MED", "rtm_source": "AUTO",
            "sf": {}, "clarity": {"Contra Costa": "", "Santa Clara": ""}}
lock = threading.RLock()
cfg = {}
stream_boot = {"proc": None}
probes = {}          # id -> latest probe result
last_ok = {}         # id -> unix time of last ok


class Refused(Exception):
    pass


# --------------------------------------------------------------------------- config
def load_cfg():
    CTL.mkdir(exist_ok=True)
    try:
        saved = json.loads(CFG_PATH.read_text())
    except (OSError, ValueError):
        saved = {}
    cfg.clear()
    cfg.update(json.loads(json.dumps(DEFAULTS)))
    cfg.update({k: v for k, v in saved.items() if k in DEFAULTS})


def save_cfg():
    CFG_PATH.write_text(json.dumps(cfg, indent=2))
    src = rtm.load_json(REPO / "rtm_sources.json")
    if cfg["rtm_source"] == "COUNTIES" and isinstance(src.get("MTC"), dict):
        src["MTC"]["url"] = None
    for name, url in cfg["clarity"].items():
        if url and isinstance(src.get(name), dict):
            src[name]["url"] = url
    (CTL / "rtm_sources.json").write_text(json.dumps(src, indent=2))
    sf = cfg.get("sf") or {}
    manual = {"San Francisco": sf} if sf.get("yes") is not None and sf.get("no") is not None else {}
    (CTL / "rtm_manual.json").write_text(json.dumps(manual, indent=2))


def load_env():
    env = {}
    try:
        for line in ENV_PATH.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    except OSError:
        pass
    return env


def mask(text):
    text = re.sub(r"(rtmps?://[^\s'\"]*/)[^/\s'\"]+", r"\1<key>", text)
    text = re.sub(r"(/macros/s/)[^/\s'\"]+", r"\1<id>", text)
    for v in load_env().values():
        if len(v) > 8:
            text = text.replace(v, "<secret>")
    return text


# --------------------------------------------------------------------------- processes
def procs():
    out = []
    for d in os.listdir("/proc"):
        if d.isdigit():
            try:
                argv = [a.decode("utf-8", "replace") for a in Path(f"/proc/{d}/cmdline").read_bytes().split(b"\0") if a]
            except OSError:
                continue
            if argv:
                out.append((int(d), argv))
    return out


def find_tracker():
    for pid, a in procs():
        if len(a) > 2 and os.path.basename(a[0]).startswith("python") and os.path.basename(a[1]) == "tracker.py" and "--serve" in a:
            return pid, a
    return None, None


def find_stream():
    for pid, a in procs():
        if os.path.basename(a[0]) == "ffmpeg" and any("rtmps://" in x for x in a):
            return pid, a
    return None, None


def age(pid):
    try:
        return int(time.time() - Path(f"/proc/{pid}").stat().st_mtime)
    except OSError:
        return None


def mode_of(argv):
    if argv is None:
        return None
    if "--mock" not in argv:
        return "REAL"
    try:
        return "ZEROS" if float(argv[argv.index("--speed") + 1]) == 0 else "MOCK"
    except (ValueError, IndexError):
        return "MOCK"


def tracker_cmd(mode):
    c = [sys.executable, "tracker.py", "--serve", str(TRACKER_PORT),
         "--rtm-sources", str(CTL / "rtm_sources.json"), "--rtm-manual", str(CTL / "rtm_manual.json")]
    if mode == "REAL":
        c += ["--interval", str(cfg["poll_interval"])]
    elif mode == "MOCK":
        c += ["--mock", "--start", "0", "--speed", str(MOCK_SPEEDS[cfg["mock_speed"]]), "--interval", "5"]
    else:
        c += ["--mock", "--start", "-30", "--speed", "0", "--interval", "10"]
    return c


def stop_tracker():
    pid, _ = find_tracker()
    if pid:
        os.kill(pid, signal.SIGTERM)
        for _ in range(30):
            time.sleep(0.2)
            if not Path(f"/proc/{pid}").exists():
                return
        os.kill(pid, signal.SIGKILL)
        time.sleep(0.5)
    for pid, a in procs():   # the mock server a --mock tracker starts
        if any(os.path.basename(x) == "mock_server.py" for x in a):
            os.kill(pid, signal.SIGTERM)


def start_tracker(mode):
    env = {k: v for k, v in os.environ.items() if not k.startswith("SHEET_")}
    if mode == "REAL":
        env.update({k: v for k, v in load_env().items() if k.startswith("SHEET_")})
    for f in ("results.json", "history.json", "races.csv"):   # generated files: don't let one mode's numbers linger in the next
        try:
            (REPO / "site" / "data" / f).unlink()
        except OSError:
            pass
    LOGS.mkdir(exist_ok=True)
    log = open(LOGS / "tracker.log", "ab")
    log.write(f"\n=== control panel: starting {mode} {datetime.now():%F %T} ===\n".encode())
    subprocess.Popen(tracker_cmd(mode), cwd=REPO, env=env, stdout=log, stderr=subprocess.STDOUT,
                     stdin=subprocess.DEVNULL, start_new_session=True)


def set_mode(mode, confirm=False):
    if mode not in ("REAL", "MOCK", "ZEROS"):
        raise Refused("unknown mode")
    with lock:
        if stream_state()["state"] != "OFF" and mode != "REAL" and not confirm:
            raise Refused("ON AIR: flip the safety cover up to put test data on the stream")
        cfg["mode"] = mode
        save_cfg()
        stop_tracker()
        start_tracker(mode)


def adopt():
    """On startup, make the running tracker (if any) match the desired mode and settings."""
    with lock:
        save_cfg()
        pid, argv = find_tracker()
        want = tracker_cmd(cfg["mode"])
        if pid and argv[1:] == want[1:]:
            return
        stop_tracker()
        start_tracker(cfg["mode"])


# --------------------------------------------------------------------------- stream
def stream_state():
    boot = stream_boot["proc"]
    booting = boot is not None and boot.poll() is None
    pid, _ = find_stream()
    if not pid:
        return {"state": "STARTING" if booting else "OFF", "pid": None, "uptime": None}
    linked = False
    try:
        ss = subprocess.run(["ss", "-tnp"], capture_output=True, text=True, timeout=5).stdout
        linked = any(f"pid={pid}," in line and "ESTAB" in line and ":443" in line for line in ss.splitlines())
    except (OSError, subprocess.TimeoutExpired):
        pass
    return {"state": "ON AIR" if linked else "CONNECTING", "pid": pid, "uptime": age(pid)}


def stream_start(confirm=False):
    with lock:
        if stream_state()["state"] != "OFF":
            return
        if cfg["mode"] != "REAL" and not confirm:
            raise Refused(f"{cfg['mode']} data is selected: flip the safety cover up to stream it")
        if not find_tracker()[0]:
            start_tracker(cfg["mode"])
        script = HOME / "bin" / "stream-start.sh"
        if not script.exists():
            raise Refused("~/bin/stream-start.sh is missing")
        stream_boot["proc"] = subprocess.Popen(["bash", str(script), BROADCAST_URL], stdin=subprocess.DEVNULL,
                                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def stream_stop():
    with lock:
        subprocess.run(["bash", str(HOME / "bin" / "stream-stop.sh"), "quiet"], timeout=20,
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(25):   # return once ffmpeg is really gone, so the next request sees the stream OFF
            if not find_stream()[0]:
                break
            time.sleep(0.2)


# --------------------------------------------------------------------------- probes
def http_probe(url, ok_codes=(200,), blocked=False):
    t0 = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
        with urllib.request.urlopen(req, timeout=8) as r:
            body = r.read(2_000_000)
            ms = int((time.time() - t0) * 1000)
            return ("ok" if r.status in ok_codes else "down"), f"HTTP {r.status}", ms, body
    except urllib.error.HTTPError as e:
        ms = int((time.time() - t0) * 1000)
        if blocked and e.code in (401, 403):
            return "wait", f"HTTP {e.code}: blocks bots, use hand entry", ms, b""
        return "down", f"HTTP {e.code}", ms, b""
    except Exception as e:   # noqa: BLE001
        return "down", (type(e).__name__ + ": " + str(e))[:70], None, b""


def results_meta():
    try:
        return json.loads((REPO / "site" / "data" / "results.json").read_text())
    except (OSError, ValueError):
        return {}


def probe_all():
    src = rtm.load_json(CTL / "rtm_sources.json") or rtm.load_json(REPO / "rtm_sources.json")
    meta = results_meta().get("meta", {})
    jobs = {}

    def plain(label, url, blocked=False, key=None):
        def run():
            state, detail, ms, _ = http_probe(url, blocked=blocked)
            m = meta.get(key) if key else None
            if state == "ok" and m is not None and (m.get("stale") or m.get("ok") is False):
                state, detail = "wait", "tracker holding last numbers (stale)"
            return {"label": label, "state": state, "detail": detail, "ms": ms}
        return run

    jobs["sos_state"] = plain("CA SoS · measures", f"{SOS}/returns/ballot-measures", key="sos_state")
    jobs["gov_state"] = plain("CA SoS · governor", f"{SOS}/returns/governor", key="gov_state")
    jobs["sos_alameda"] = plain("CA SoS · Alameda", f"{SOS}/returns/ballot-measures/county/alameda", key="sos_alameda")
    jobs["alameda"] = plain("Alameda Registrar", ALA, key="alameda")

    def mtc():
        url = (src.get("MTC") or {}).get("url") or "https://mtc.ca.gov/about-mtc/authorities/public-transit-revenue-measure-district"
        state, detail, ms, body = http_probe(url)
        if state == "ok":
            try:
                y, n, _ = rtm.parse_mtc(body.decode("utf-8", "replace"))
                detail = f"RESULTS POSTED  yes {y:,} / no {n:,}"
            except LookupError:
                state, detail = "wait", "page up, no results posted yet"
        return {"label": "MTC · RTM total", "state": state, "detail": detail, "ms": ms}
    jobs["mtc"] = mtc
    jobs["sanmateo"] = plain("San Mateo · RTM", (src.get("San Mateo") or {}).get("url") or "https://smcacre.gov/node/3146")
    jobs["sf"] = plain("San Francisco · RTM", (src.get("San Francisco") or {}).get("url") or "https://www.sfelections.org/results/20261103/index.html", blocked=True)

    for key, name in (("cc", "Contra Costa"), ("sc", "Santa Clara")):
        def clarity(name=name):
            url = ((src.get(name) or {}).get("url") or "").rstrip("/")
            if not url:
                return {"label": f"{name} · Clarity", "state": "off", "detail": "address not set", "ms": None}
            state, detail, ms, _ = http_probe(url + "/current_ver.txt")
            return {"label": f"{name} · Clarity", "state": state, "detail": detail, "ms": ms}
        jobs[key] = clarity

    def sheet():
        s = meta.get("sheet")
        mode = mode_of(find_tracker()[1])
        if mode != "REAL":
            return {"label": "Google Sheet", "state": "off", "detail": f"not written in {mode or 'no'} mode", "ms": None}
        if not s:
            return {"label": "Google Sheet", "state": "wait", "detail": "no sheet sync yet", "ms": None}
        ok = s.get("ok") and not s.get("stale")
        return {"label": "Google Sheet", "state": "ok" if ok else "down",
                "detail": f"hand edits {s.get('edits', 0)} · on hold {s.get('on_hold', 0)}" if ok else "tracker cannot reach the sheet", "ms": None}
    jobs["sheet"] = sheet

    def facebook():
        t0 = time.time()
        try:
            socket.create_connection(("live-api-s.facebook.com", 443), 5).close()
            return {"label": "Facebook RTMPS", "state": "ok", "detail": "ingest reachable", "ms": int((time.time() - t0) * 1000)}
        except OSError as e:
            return {"label": "Facebook RTMPS", "state": "down", "detail": str(e)[:60], "ms": None}
    jobs["facebook"] = facebook

    def tunnel():
        running = any(os.path.basename(a[0]) == "cloudflared" for _, a in procs())
        url = None
        try:
            m = re.findall(r"https://[a-z0-9-]+\.trycloudflare\.com", (LOGS / "tunnel.log").read_text())
            url = m[-1] if m else None
        except OSError:
            pass
        return {"label": "Cloudflare tunnel", "state": "ok" if running else "off",
                "detail": url or ("running" if running else "not running"), "ms": None}
    jobs["tunnel"] = tunnel

    with ThreadPoolExecutor(8) as ex:
        futs = {k: ex.submit(fn) for k, fn in jobs.items()}
        for k, f in futs.items():
            try:
                r = f.result(timeout=20)
            except Exception as e:   # noqa: BLE001
                r = {"label": k, "state": "down", "detail": str(e)[:60], "ms": None}
            if r["state"] == "ok":
                last_ok[k] = time.time()
            r["id"], r["last_ok"] = k, last_ok.get(k)
            probes[k] = r


def prober():
    while True:
        try:
            probe_all()
        except Exception as e:   # noqa: BLE001
            print("probe error", e, file=sys.stderr)
        time.sleep(30)


# --------------------------------------------------------------------------- state
def returns(res):
    """What the tracker is holding right now, for the panel's returns board."""
    out = {}
    yn = lambda m: {k: m.get(k) for k in ("yes", "no", "yes_pct", "no_pct", "precincts")} if isinstance(m, dict) else None
    try:
        meta = res.get("meta") or {}
        out["sos_time"] = (meta.get("sos_state") or {}).get("reporting_time")
        out["alameda_time"] = (meta.get("alameda") or {}).get("updated")
        out["precincts"] = (meta.get("sos_state") or {}).get("precincts")
        out["alameda_precincts"] = (meta.get("sos_alameda") or {}).get("precincts")
        out["errors"] = [{"source": e.get("source"), "error": mask(str(e.get("error")))[:160]} for e in (meta.get("errors") or [])[:8]]
        out["warnings"] = [mask(str(w))[:160] for w in (meta.get("warnings") or [])[:8]]
        h = res.get("headline") or {}
        out["headline"] = {"number": h.get("number"), "state": yn(h.get("state")), "alameda": yn(h.get("alameda")),
                           "alameda_page": yn(h.get("alameda_page")), "agree": h.get("alameda_sources_agree")}
        gov = (res.get("contests") or {}).get("governor") or {}
        out["gov"] = {where: [{k: c.get(k) for k in ("name", "party", "votes", "pct")} for c in ((gov.get(where) or {}).get("candidates") or [])[:2]]
                      for where in ("state", "alameda")}
        r = res.get("rtm") or {}
        if r:
            out["rtm"] = {"total": yn(r.get("total")), "counties_in": r.get("counties_in"), "complete": r.get("complete"),
                          "source": r.get("source") or "COUNTIES",
                          "counties": [{k: c.get(k) for k in ("county", "yes", "no", "yes_pct", "precincts", "source", "status", "note")}
                                       for c in r.get("counties") or []]}
    except (AttributeError, KeyError, TypeError):
        pass
    return out


def history(n=240):
    """The tracker's Prop 40 history, thinned to n points (newest kept), for the strip-chart recorder."""
    try:
        h = json.loads((REPO / "site" / "data" / "history.json").read_text())
    except (OSError, ValueError):
        return []
    pts = h[::-1][::max(1, len(h) // n)][::-1]
    return [{k: p.get(k) for k in ("t", "state_yes_pct", "alameda_yes_pct", "state_precincts_pct")} for p in pts if isinstance(p, dict)]


def state():
    tp, targv = find_tracker()
    res = results_meta()
    gen = res.get("generated_at")
    data_age = None
    if gen:
        try:
            data_age = int((datetime.now(timezone.utc) - datetime.fromisoformat(gen.replace("Z", "+00:00"))).total_seconds())
        except ValueError:
            pass
    order = ["sos_state", "gov_state", "sos_alameda", "alameda", "mtc", "sanmateo", "sf", "cc", "sc", "sheet", "facebook", "tunnel"]
    return {
        "now": time.time(), "host": socket.gethostname(), "clock": datetime.now().strftime("%a %b %d  %I:%M:%S %p %Z"),
        "mode": mode_of(targv), "wanted_mode": cfg["mode"],
        "tracker": {"pid": tp, "uptime": age(tp) if tp else None, "data_age": data_age},
        "stream": stream_state(), "probes": [probes[k] for k in order if k in probes],
        "config": {k: cfg[k] for k in ("poll_interval", "mock_speed", "rtm_source", "sf", "clarity")},
        "mock_speeds": list(MOCK_SPEEDS), "returns": returns(res),
    }


def tail(name, n=40):
    p = LOGS / name
    try:
        lines = p.read_text(errors="replace").splitlines()[-n:]
    except OSError:
        return "(no log yet)"
    return mask("\n".join(l for l in lines if "GET /" not in l and '" 200 -' not in l and "code 404" not in l and '" 404 -' not in l))


# --------------------------------------------------------------------------- http
class Handler(BaseHTTPRequestHandler):
    server_version = "ControlPanel/1"

    def log_message(self, *a):
        pass

    def _host_ok(self):
        return self.headers.get("Host", "") in (f"localhost:{PORT}", f"127.0.0.1:{PORT}")

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {"error": "bad host"})
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            return self._send(200, (HERE / "index.html").read_bytes(), "text/html; charset=utf-8")
        if path == "/api/state":
            return self._send(200, state())
        if path == "/api/history":
            return self._send(200, history())
        if path == "/api/log":
            q = self.path.partition("?")[2]
            name = "stream.log" if "stream" in q else "tracker.log"
            return self._send(200, {"name": name, "text": tail(name)})
        if path == "/video.mjpg":
            return self._video()
        self._send(404, {"error": "not found"})

    def _video(self):
        if stream_state()["state"] == "OFF":
            return self._send(404, {"error": "no signal"})
        ff = subprocess.Popen(["ffmpeg", "-nostdin", "-loglevel", "error", "-draw_mouse", "0", "-f", "x11grab", "-framerate", "5",
                               "-video_size", "1080x1920", "-i", XDISPLAY, "-vf", "scale=360:640", "-q:v", "6", "-f", "mpjpeg", "-"],
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace;boundary=ffmpeg")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            while True:
                chunk = ff.stdout.read(16384)
                if not chunk:
                    break
                self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            ff.kill()

    def do_POST(self):
        origin = self.headers.get("Origin")
        if not self._host_ok() or (origin and origin not in (f"http://localhost:{PORT}", f"http://127.0.0.1:{PORT}")) \
                or self.headers.get("X-Control") != "1":
            return self._send(403, {"error": "forbidden"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            path = self.path.split("?")[0]
            if path == "/api/mode":
                set_mode(body.get("mode"), bool(body.get("confirm")))
                msg = f"DATA MODE -> {body.get('mode')}"
            elif path == "/api/stream":
                if body.get("action") == "start":
                    stream_start(bool(body.get("confirm")))
                    msg = "STREAM START sent"
                elif body.get("action") == "stop":
                    stream_stop()
                    msg = "STREAM STOPPED"
                else:
                    raise Refused("unknown stream action")
            elif path == "/api/config":
                msg = apply_config(body)
            else:
                return self._send(404, {"error": "not found"})
            return self._send(200, {"ok": True, "message": msg})
        except Refused as e:
            return self._send(409, {"ok": False, "message": str(e)})
        except Exception as e:   # noqa: BLE001
            return self._send(500, {"ok": False, "message": f"{type(e).__name__}: {e}"[:160]})


def apply_config(b):
    restart = False
    with lock:
        if "rtm_source" in b:
            if b["rtm_source"] not in ("AUTO", "COUNTIES"):
                raise Refused("bad rtm_source")
            cfg["rtm_source"] = b["rtm_source"]
        if "poll_interval" in b:
            if int(b["poll_interval"]) not in (30, 60, 120):
                raise Refused("poll interval must be 30, 60 or 120")
            restart = restart or int(b["poll_interval"]) != cfg["poll_interval"]
            cfg["poll_interval"] = int(b["poll_interval"])
        if "mock_speed" in b:
            if b["mock_speed"] not in MOCK_SPEEDS:
                raise Refused("bad mock speed")
            restart = restart or b["mock_speed"] != cfg["mock_speed"]
            cfg["mock_speed"] = b["mock_speed"]
        if "sf" in b:
            sf = b["sf"] or {}
            if sf:
                cfg["sf"] = {"yes": int(sf["yes"]), "no": int(sf["no"]), "precincts_done": int(sf.get("precincts_done") or 0),
                             "precincts_total": int(sf.get("precincts_total") or 514), "as_of": str(sf.get("as_of") or "")[:40]}
            else:
                cfg["sf"] = {}
        if "clarity" in b:
            for name in ("Contra Costa", "Santa Clara"):
                url = str((b["clarity"] or {}).get(name, cfg["clarity"].get(name, ""))).strip()
                if url and not re.match(r"^https://results\.enr\.clarityelections\.com/CA/[A-Za-z_]+/\d+/?$", url):
                    raise Refused(f"{name}: expected https://results.enr.clarityelections.com/CA/<County>/<number>")
                cfg["clarity"][name] = url
        save_cfg()
        if restart:
            stop_tracker()
            start_tracker(cfg["mode"])
    return "SETTINGS SAVED" + (" · tracker restarted" if restart else " · applies next poll")


def main():
    load_cfg()
    adopt()
    threading.Thread(target=prober, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.daemon_threads = True
    print(f"control panel on http://127.0.0.1:{PORT}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
