"""One poll, published to the static site bucket. Run by the Cloud Run Job `election-tracker-poll`.

The site (index.html, app/, geo/, ...) lives in a public GCS bucket. Each run:
  1. downloads data/history.json from the bucket (so the chart keeps growing between runs),
  2. runs tracker.py once into a scratch dir,
  3. uploads results.json, history.json and races.csv with Cache-Control: no-cache.
A run where a results source (SoS, Alameda) failed uploads nothing, so the bucket keeps the last good numbers;
each run starts with no memory of earlier ones. Stdlib only.

Env: SITE_BUCKET (required), RTM_CONFIG (dir with rtm_sources.json, rtm_manual.json, calls.json),
SHEET_URL/SHEET_SECRET (optional). Locally: GCS_TOKEN=$(gcloud auth print-access-token).
"""
import json
import os
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import tracker

CORE = {"sos_state", "sos_alameda", "alameda", "gov_state", "gov_alameda"}
FILES = {"results.json": "application/json", "history.json": "application/json", "races.csv": "text/csv; charset=utf-8"}


def token():
    if os.environ.get("GCS_TOKEN"):
        return os.environ["GCS_TOKEN"]
    req = urllib.request.Request(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)["access_token"]


def download(bucket, name, dest, tok):
    url = f"https://storage.googleapis.com/storage/v1/b/{bucket}/o/{urllib.parse.quote(name, safe='')}?alt=media"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}"}), timeout=30) as r:
            dest.write_bytes(r.read())
        return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        raise


def upload(bucket, name, body, content_type, tok):
    meta = json.dumps({"name": name, "contentType": content_type, "cacheControl": "no-cache, max-age=0"})
    b = "----publish-boundary"
    data = (f"--{b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n"
            f"--{b}\r\nContent-Type: {content_type}\r\n\r\n").encode() + body + f"\r\n--{b}--\r\n".encode()
    req = urllib.request.Request(
        f"https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o?uploadType=multipart",
        data=data, method="POST",
        headers={"Authorization": f"Bearer {tok}", "Content-Type": f"multipart/related; boundary={b}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        r.read()


def main():
    bucket = os.environ["SITE_BUCKET"]
    cfg = Path(os.environ.get("RTM_CONFIG", tracker.HERE))
    tok = token()
    out = Path(tempfile.mkdtemp(prefix="data-"))
    had_history = download(bucket, "data/history.json", out / "history.json", tok)
    print(f"[publish] history from bucket: {'yes' if had_history else 'none yet'}", flush=True)

    args = ["--once", "--out", str(out), "--rtm-sources", str(cfg / "rtm_sources.json"),
            "--rtm-manual", str(cfg / "rtm_manual.json"), "--calls", str(cfg / "calls.json")]
    tracker.main(args)   # SHEET_URL / SHEET_SECRET are read from the environment by tracker's argparse defaults

    snap = json.loads((out / "results.json").read_text())
    failed = sorted({e["source"] for e in snap["meta"]["errors"]} & CORE)
    if failed:
        print(f"[publish] not uploading: {', '.join(failed)} failed this run; the bucket keeps the last good results", flush=True)
        return 1
    for name, ctype in FILES.items():
        p = out / name
        if p.exists():
            upload(bucket, f"data/{name}", p.read_bytes(), ctype, tok)
    print(f"[publish] uploaded {', '.join(n for n in FILES if (out / n).exists())} to gs://{bucket}/data/", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
