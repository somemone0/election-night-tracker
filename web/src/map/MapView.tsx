// The zoomable map: MapLibre GL with the boundary layers, race cards, council-district labels and hover names.
// The map is created once; data and view changes only restyle it. Zooming across a band edge (or panning out of the
// area) asks the app to change the view; clicks on areas, cards and the level buttons move the camera.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import maplibregl, { type Map as MlMap, type MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { RANK } from "../config";
import type { CardSpec } from "../lib/cards";
import { anchor, featureById } from "../lib/geo";
import { effectiveZoom, nextView } from "../lib/levels";
import type { BBox, Geo, Level, View } from "../types";
import { ActiveArea, addAreas, HIT_LAYERS, HIT_SOURCE, syncWards } from "./areas";
import { firstStreetLayer, loadStyle } from "./basemap";
import { CardLayer } from "./CardLayer";

export interface CameraRequest { bbox: BBox; seq: number; instant?: boolean }

interface Props {
  geo: Geo;
  view: View;
  camera: CameraRequest;
  cards: CardSpec[];
  elected: Set<string>;
  activeWard: string | null;
  rightInset: number;
  onZoomView: (v: View) => void;
  onPick: (level: Level, id: string) => void;
  onWard: (id: string) => void;
  onCard: (s: CardSpec) => void;
}

const WARD_LABEL_ZOOM = 10.5;

export function MapView(props: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const live = useRef(props); live.current = props;         // handlers read the latest props without re-binding
  const active = useRef<ActiveArea | null>(null);
  const programmatic = useRef(false);
  const anchorZ = useRef<number | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const appliedSeq = useRef<number | null>(null);

  const visible = (m: MlMap) => {
    const c = m.getContainer(), wide = window.innerWidth > 860, inset = wide ? live.current.rightInset : 0;
    return { w: c.clientWidth - inset, h: c.clientHeight, inset };
  };
  const zeff = (m: MlMap) => { const v = visible(m); return effectiveZoom(m.getZoom(), v.w, v.h); };
  const visCenter = (m: MlMap) => { const v = visible(m); return m.unproject([v.w / 2, v.h / 2]); };
  const padding = (m: MlMap) => ({ top: 40, bottom: 40, left: 72, right: visible(m).inset + 24 });

  // create the map once
  useEffect(() => {
    let m: MlMap | null = null, alive = true;
    (async () => {
      const { style } = await loadStyle();
      if (!alive || !box.current) return;
      try {
        const [w, s, e, n] = live.current.camera.bbox;
        m = new maplibregl.Map({
          container: box.current, style, bounds: [[w, s], [e, n]], minZoom: 4, maxZoom: 16.5,
          dragRotate: false, pitchWithRotate: false, touchPitch: false, attributionControl: false, fadeDuration: 0,
        });
      } catch (err) {
        setFailed((err as Error).message || "WebGL is not available");
        return;
      }
      m.touchZoomRotate.disableRotation();
      m.keyboard.disableRotation();
      m.scrollZoom.setWheelZoomRate(1 / 260);   // a little quicker than MapLibre's default
      m.scrollZoom.setZoomRate(1 / 70);
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
      m.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-left");
      m.on("error", ev => console.warn("map:", ev.error?.message || ev));   // a tile failing to load must not break the page
      m.once("load", () => {
        if (!alive || !m) return;
        addAreas(m, live.current.geo, firstStreetLayer(m.getStyle()));
        active.current = new ActiveArea(m);
        m.fitBounds(live.current.camera.bbox, { padding: padding(m), duration: 0 });
        anchorZ.current = zeff(m);
        appliedSeq.current = live.current.camera.seq;
        (window as any).__map = m;   // handy for debugging in the console
        setMap(m);
      });
    })();
    return () => { alive = false; m?.remove(); };
  }, []);

  // the area in view (cross-faded) and the council districts
  useEffect(() => {
    if (!map || !active.current) return;
    const { geo, view } = props;
    active.current.show(view.level === "state" ? featureById(geo, "state", "CA") : featureById(geo, view.level, view.id));
  }, [map, props.view, props.geo]);
  const berkeleyInView = props.view.level === "city" && props.view.id === "Berkeley";
  useEffect(() => { if (map) syncWards(map, props.geo, props.elected, props.activeWard, berkeleyInView); }, [map, props.elected, props.activeWard, props.geo, berkeleyInView]);

  // camera requests (clicks, level buttons, the URL). A layout effect, so the flight has started (movestart fired)
  // before the card layer sees the new view and knows to hold new cards until it lands.
  useLayoutEffect(() => {
    if (!map || appliedSeq.current === props.camera.seq) return;
    appliedSeq.current = props.camera.seq;
    programmatic.current = true;
    const done = () => { programmatic.current = false; anchorZ.current = zeff(map); };
    map.once("moveend", done);
    const t = window.setTimeout(done, 1600);
    map.fitBounds(props.camera.bbox, { padding: padding(map), duration: props.camera.instant ? 0 : 750, essential: true });
    return () => window.clearTimeout(t);
  }, [map, props.camera.seq]);

  // a new view (from any source) resets the zoom the band check measures from
  useEffect(() => { if (map && !programmatic.current) anchorZ.current = zeff(map); }, [map, props.view]);

  // zoom/pan -> level changes, hover names, clicks on areas
  useEffect(() => {
    if (!map) return;
    let timer = 0, hovered: { source: string; id: string } | null = null, zooming = false;
    const container = map.getContainer();

    const onMoveEnd = () => {
      if (programmatic.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const z = zeff(map), c = visCenter(map), { geo, view } = live.current;
        // anchorZ is the zoom when the view last changed (not the last stop), so many small zooms add up
        const v = nextView(geo, view, c, z, anchorZ.current);
        if (v) { anchorZ.current = z; live.current.onZoomView(v); }
      }, 120);
    };

    // finest area under the pointer that can be picked from the current view
    const pick = (pt: maplibregl.PointLike): { level: Level | "ward"; id: string; name: string; f: MapGeoJSONFeature } | null => {
      const feats = map.queryRenderedFeatures(pt, { layers: HIT_LAYERS.filter(l => map.getLayer(l)) });
      const { view, elected } = live.current;
      for (const layer of HIT_LAYERS) {
        const f = feats.find(x => x.layer.id === layer);
        if (!f) continue;
        const level = HIT_SOURCE[layer], id = String(f.properties.id);
        if (level === "ward") {
          if (view.level === "city" && view.id === "Berkeley" && elected.has(id)) return { level, id, name: `District ${id}`, f };
          continue;
        }
        if (RANK[level] <= RANK[view.level] && !(view.level === level && view.id === id)) return { level, id, name: String(f.properties.name), f };
      }
      return null;
    };
    const setHover = (h: typeof hovered) => {
      if (hovered && (!h || h.source !== hovered.source || h.id !== hovered.id)) map.setFeatureState({ source: hovered.source, id: hovered.id }, { hover: false });
      if (h) map.setFeatureState({ source: h.source, id: h.id }, { hover: true });
      hovered = h;
    };
    const hideTip = () => { if (tip.current) tip.current.style.opacity = "0"; container.style.cursor = ""; setHover(null); };
    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (zooming || (e.originalEvent.target as Element)?.closest?.(".card")) return hideTip();
      const p = pick(e.point);
      if (!p) return hideTip();
      setHover({ source: p.level, id: p.id });
      container.style.cursor = "pointer";
      if (tip.current) {
        tip.current.textContent = p.name;
        tip.current.style.transform = `translate3d(${Math.round(e.point.x)}px, ${Math.round(e.point.y) - 14}px, 0) translate(-50%, -100%)`;
        tip.current.style.opacity = "1";
      }
    };
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if ((e.originalEvent.target as Element)?.closest?.(".card")) return;
      const p = pick(e.point);
      if (!p) return;
      hideTip();
      if (p.level === "ward") live.current.onWard(p.id); else live.current.onPick(p.level, p.id);
    };
    const onZoomStart = () => { zooming = true; hideTip(); container.classList.add("zooming"); };
    const onZoomEnd = () => { zooming = false; container.classList.remove("zooming"); };
    const onZoom = () => container.classList.toggle("wards-on", map.getZoom() >= WARD_LABEL_ZOOM);

    map.on("moveend", onMoveEnd); map.on("mousemove", onMouseMove); map.on("mouseout", hideTip); map.on("click", onClick);
    map.on("zoomstart", onZoomStart); map.on("zoomend", onZoomEnd); map.on("zoom", onZoom);
    onZoom();
    return () => {
      window.clearTimeout(timer);
      map.off("moveend", onMoveEnd); map.off("mousemove", onMouseMove); map.off("mouseout", hideTip); map.off("click", onClick);
      map.off("zoomstart", onZoomStart); map.off("zoomend", onZoomEnd); map.off("zoom", onZoom);
    };
  }, [map]);

  // keep the canvas sized to its box (the panel and banners can change the layout)
  useEffect(() => {
    if (!map || !box.current) return;
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [map]);

  const overlay = map ? map.getCanvasContainer() : null;
  return (
    <>
      <div ref={box} className="map" />
      {failed && <div className="nomap">The map could not be loaded ({failed}). Use the buttons above to switch between city, district, county and state results.</div>}
      {map && overlay && createPortal(
        <>
          <WardLabels map={map} geo={props.geo} elected={berkeleyInView ? props.elected : new Set()} activeWard={props.activeWard} />
          <CardLayer map={map} cards={props.cards} rightInset={window.innerWidth > 860 ? props.rightInset : 0} activeWard={props.activeWard} onCard={props.onCard} />
          <div ref={tip} className="maptip" aria-hidden="true" />
        </>, overlay)}
    </>
  );
}

/** District numbers on Berkeley's council districts; shown once zoomed in far enough (CSS .wards-on). */
function WardLabels({ map, geo, elected, activeWard }: { map: MlMap; geo: Geo; elected: Set<string>; activeWard: string | null }) {
  const els = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    const place = () => {
      for (const f of geo.ward.features) {
        const el = els.current.get(String(f.properties.id));
        if (!el) continue;
        const p = map.project(anchor(f));
        el.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0) translate(-50%, -50%)`;
      }
    };
    place();
    map.on("move", place);
    return () => { map.off("move", place); };
  }, [map, geo]);
  return (
    <div className="wardlabels" aria-hidden="true">
      {geo.ward.features.map(f => {
        const id = String(f.properties.id);
        return <div key={id} className={"wl" + (elected.has(id) ? " on" : "") + (activeWard === id ? " sel" : "")}
          ref={el => { if (el) els.current.set(id, el); else els.current.delete(id); }}>{id}</div>;
      })}
    </div>
  );
}
