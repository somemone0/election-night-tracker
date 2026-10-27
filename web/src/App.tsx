import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CONFIG, HOME } from "./config";
import { Banners, Legend, TopBar } from "./components/Chrome";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useGeo } from "./hooks/useGeo";
import { useResults } from "./hooks/useResults";
import { type CardSpec, cardSpecs, electedWards, visibleCards, WARD_RE } from "./lib/cards";
import { cityDistricts, featureById, nameOf } from "./lib/geo";
import { districtOf, normalizeView, viewFromHash, viewToHash } from "./lib/levels";
import { type CameraRequest, MapView } from "./map/MapView";
import { ResultsPanel } from "./panels/ResultsPanel";
import type { BBox, Geo, Level, View } from "./types";

export default function App() {
  const feed = useResults();
  const { geo, error: geoError } = useGeo();
  if (!geo) return <Shell feed={feed} message={geoError ? `Loading map boundaries… (${geoError})` : "Loading…"} />;
  return <Tracker geo={geo} feed={feed} />;
}

function Shell({ feed, message }: { feed: ReturnType<typeof useResults>; message: string }) {
  return (
    <>
      <TopBar feed={feed} view={CONFIG.start} names={{ city: null, congress: null, county: null, state: null }} onLevel={() => {}} />
      <div className="app"><div className="nomap on">{message}</div></div>
    </>
  );
}

const bboxOf = (geo: Geo, level: Level | "ward", id: string): BBox =>
  (featureById(geo, level, id) ?? featureById(geo, "state", "CA"))!.properties.bbox;

function Tracker({ geo, feed }: { geo: Geo; feed: ReturnType<typeof useResults> }) {
  const D = feed.data;
  const initial = useMemo(() => viewFromHash(geo, location.hash) ?? CONFIG.start, [geo]);
  const [view, setView] = useState<View>(initial);
  const [activeWard, setActiveWard] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraRequest>(() => ({ bbox: bboxOf(geo, initial.level, initial.id), seq: 0, instant: true }));
  const [focus, setFocus] = useState<{ id: string; seq: number } | null>(null);
  const [chain, setChain] = useState(() => ({ city: HOME, congress: districtOf(geo, HOME) ?? "12" }));
  const panelRef = useRef<HTMLElement>(null);
  const [inset, setInset] = useState(480);

  // remember the last city/district so the level buttons know where to go
  useEffect(() => {
    if (view.level === "city") setChain({ city: view.id, congress: districtOf(geo, view.id) ?? chain.congress });
    if (view.level === "congress") setChain(c => ({ ...c, congress: view.id }));
    if (!(view.level === "city" && view.id === "Berkeley")) setActiveWard(null);
    history.replaceState(null, "", viewToHash(view));
  }, [view, geo]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the results card covers the right of the map on wide screens
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setInset(el.offsetWidth + 36));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!D]);   // eslint-disable-line react-hooks/exhaustive-deps

  const moveTo = useCallback((level: Level | "ward", id: string) => setCamera(c => ({ bbox: bboxOf(geo, level, id), seq: c.seq + 1 })), [geo]);
  const go = useCallback((level: Level, id: string) => {
    const v = normalizeView(geo, level, id);
    if (!v) return;
    setView(prev => (prev.level === v.level && prev.id === v.id ? prev : v));
    moveTo(v.level, v.id);
  }, [geo, moveTo]);

  const selectWard = useCallback((id: string) => {
    setActiveWard(id);
    setView(prev => (prev.level === "city" && prev.id === "Berkeley" ? prev : { level: "city", id: "Berkeley" }));
    moveTo("ward", id);
    const r = D?.races.find(r => r.city === "Berkeley" && WARD_RE.exec(r.title)?.[1] === id);
    if (r) setFocus(f => ({ id: "race-" + r.id, seq: (f?.seq ?? 0) + 1 }));
  }, [D, moveTo]);

  const onCard = useCallback((s: CardSpec) => {
    if (s.scope === "ward") return selectWard(s.area[1]);
    if (!(view.level === s.go.level && view.id === s.go.id)) go(s.go.level, s.go.id);
    if (s.focus) setFocus(f => ({ id: s.focus!, seq: (f?.seq ?? 0) + 1 }));
  }, [view, go, selectWard]);

  const onZoomView = useCallback((v: View) => setView(v), []);

  const cityCd = useMemo(() => cityDistricts(geo), [geo]);
  const allCards = useMemo(() => cardSpecs(D, geo), [D, geo]);
  const cards = useMemo(() => visibleCards(allCards, view, cityCd), [allCards, view, cityCd]);
  const elected = useMemo(() => electedWards(D), [D]);

  const names = {
    city: chain.city ? nameOf(geo, "city", chain.city) : null,
    congress: chain.congress ? `District ${chain.congress}` : null,
    county: "Alameda County", state: "California",
  };
  const onLevel = (l: Level) => go(l, l === "city" ? chain.city : l === "congress" ? chain.congress : l === "county" ? "alameda" : "CA");

  return (
    <>
      <TopBar feed={feed} view={view} names={names} onLevel={onLevel} />
      <div className="app">
        <section className="mapcol" aria-label="Map of results by area">
          <ErrorBoundary label="the map">
            <MapView geo={geo} view={view} camera={camera} cards={D ? cards : []} elected={elected} activeWard={activeWard} rightInset={inset}
              onZoomView={onZoomView} onPick={go} onWard={selectWard} onCard={onCard} />
          </ErrorBoundary>
          <Legend empty={!!D && !cards.length} />
        </section>
        <div className="sidecol">
          <Banners feed={feed} />
          {D ? <ResultsPanel ref={panelRef} D={D} history={feed.history} geo={geo} view={view} go={go} focus={focus} />
            : <aside className="results" ref={panelRef}><p className="empty">{feed.error ?? "Loading results…"}</p></aside>}
        </div>
      </div>
    </>
  );
}
