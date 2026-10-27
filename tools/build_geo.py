#!/usr/bin/env python3
"""Build the map boundaries in site/geo/ from official public sources.

  state    Census TIGERweb "States" layer (generalized by the server)
  county   Alameda County "County_Boundary" feature service
  congress Alameda County Registrar "US_Congressional_Districts" (the 2026 lines, clipped to the county)
  city     Alameda County Registrar "Registrar_of_Voters_City_Boundaries" (voting-city boundaries)
  ward     Alameda County "City_Council_Districts", Berkeley's eight council districts only (used to place race bubbles)

The county layers come from https://data.acgov.org (the datasets linked from the Registrar's eData page).
Output is compact GeoJSON with {level, id, name, bbox} properties; coordinates are rounded to 5 decimals.

    python3 tools/build_geo.py
"""
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "site" / "geo"
ACGOV = "https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services"
TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query"
UA = {"User-Agent": "election-tracker/1.0 (geo build)"}


def query(url, **params):
    q = {"outSR": 4326, "f": "geojson", "returnGeometry": "true", **params}
    req = urllib.request.Request(url + "?" + urllib.parse.urlencode(q), headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    if "error" in data or not data.get("features"):
        raise SystemExit(f"{url}: {data.get('error') or 'no features'}")
    return data["features"]


def polys(g):
    return g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]


def rnd(g):
    f = lambda pt: [round(pt[0], 5), round(pt[1], 5)]
    return {"type": g["type"], "coordinates": [[[f(p) for p in ring] for ring in poly] for poly in polys(g)]
            if g["type"] == "MultiPolygon" else [[f(p) for p in ring] for ring in g["coordinates"]]}


def bbox(g):
    pts = [p for poly in polys(g) for p in poly[0]]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return [round(min(xs), 5), round(min(ys), 5), round(max(xs), 5), round(max(ys), 5)]


def collection(level, items):
    feats = []
    for fid, name, geom in items:
        geom = rnd(geom)
        feats.append({"type": "Feature", "properties": {"level": level, "id": fid, "name": name, "bbox": bbox(geom)}, "geometry": geom})
    return {"type": "FeatureCollection", "features": feats}


def write(name, fc):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.json"
    path.write_text(json.dumps(fc, separators=(",", ":")))
    print(f"{path.name}: {len(fc['features'])} features, {path.stat().st_size / 1024:.1f} KB")


def main():
    st = query(TIGER, where="STUSAB='CA'", outFields="NAME", maxAllowableOffset=0.006, geometryPrecision=4)
    write("state", collection("state", [("CA", "California", st[0]["geometry"])]))

    co = query(f"{ACGOV}/County_Boundary/FeatureServer/0/query", where="1=1", outFields="NAME", maxAllowableOffset=0.0004, geometryPrecision=5)
    write("county", collection("county", [("alameda", "Alameda County", co[0]["geometry"])]))

    cds = query(f"{ACGOV}/US_Congressional_Districts/FeatureServer/0/query", where="1=1", outFields="DIST_NAME", maxAllowableOffset=0.0004, geometryPrecision=5)
    items = []
    for f in cds:
        n = int(re.match(r"(\d+)", f["properties"]["DIST_NAME"]).group(1))
        items.append((str(n), f"Congressional District {n}", f["geometry"]))
    write("congress", collection("congress", sorted(items, key=lambda x: int(x[0]))))

    cities = query(f"{ACGOV}/Registrar_of_Voters_City_Boundaries/FeatureServer/0/query", where="1=1", outFields="DIST_NAME", maxAllowableOffset=0.0004, geometryPrecision=5)
    items = []
    for f in cities:
        name = f["properties"]["DIST_NAME"].replace("CITY OF ", "").title()
        items.append((name, name, f["geometry"]))
    write("city", collection("city", sorted(items)))

    wards = query(f"{ACGOV}/City_Council_Districts/FeatureServer/0/query", where="DIST_NAME LIKE 'CITY OF BERKELEY, DISTRICT #%'", outFields="DIST_NAME", maxAllowableOffset=0.0003, geometryPrecision=5)
    items = []
    for f in wards:
        n = int(re.search(r"#(\d+)", f["properties"]["DIST_NAME"]).group(1))
        items.append((str(n), f"Berkeley District {n}", f["geometry"]))
    write("ward", collection("ward", sorted(items, key=lambda x: int(x[0]))))


if __name__ == "__main__":
    main()
