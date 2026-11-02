import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CONFIG, HOME, HOME_COUNTY } from "./config";
import { Banners, Legend, TopBar } from "./components/Chrome";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RaceStrip } from "./components/RaceStrip";
import { useBallot } from "./hooks/useBallot";
import { useGeo } from "./hooks/useGeo";
import { useResults } from "./hooks/useResults";
import { type CardSpec, cardSpecs, electedWards, stripCards, visibleCards, WARD_RE } from "./lib/cards";
import { featureById, nameOf } from "./lib/geo";
import { normalizeView, viewFromHash, viewToHash } from "./lib/levels";
import { type CameraRequest, MapView } from "./map/MapView";
import { defaultSelection } from "./panels/Detail";
import { ResultsPanel } from "./panels/ResultsPanel";
import type { BBox, Geo, Level, View } from "./types";
import { S } from "./strings";

export default function App() {
  const feed = useResults();
  const { geo, error: geoError } = useGeo();
  if (!geo) return <Shell feed={feed} message={geoError ? S.loadingBoundaries(geoError) : S.loadingAll} />;
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

// The county level always frames all five Measure RTM counties (CA-12 is inside them).
const bboxOf = (geo: Geo, level: Level | "ward", id: string): BBox => {
  if (level === "county") {
    const bs = geo.county.features.map(f => f.properties.bbox);
    return [Math.min(...bs.map(b => b[0])), Math.min(...bs.map(b => b[1])), Math.max(...bs.map(b => b[2])), Math.max(...bs.map(b => b[3]))];
  }
  return (featureById(geo, level, id) ?? featureById(geo, "state", "CA"))!.properties.bbox;
};
const keyOf = (v: View) => `${v.level}:${v.id}`;

function Tracker({ geo, feed }: { geo: Geo; feed: ReturnType<typeof useResults> }) {
  const D = feed.data;
  const ballot = useBallot();
  const initial = useMemo(() => viewFromHash(geo, location.hash) ?? CONFIG.start, [geo]);
  const [view, setView] = useState<View>(initial);
  const [camera, setCamera] = useState<CameraRequest>(() => ({ bbox: bboxOf(geo, initial.level, initial.id), seq: 0, instant: true }));
  // the race picked for the detail panel, for the view it was picked in; other views open on their own default race
  const [picked, setPicked] = useState<{ view: string; sel: string } | null>(null);
  const [chain, setChain] = useState(() => ({ city: HOME, county: HOME_COUNTY }));
  const panelRef = useRef<HTMLElement>(null);
  const [inset, setInset] = useState(480);
  const [stripH, setStripH] = useState(0);

  // remember the last city so the level buttons know where to go
  useEffect(() => {
    if (view.level === "city") setChain(c => ({ ...c, city: view.id }));
    history.replaceState(null, "", viewToHash(view));
  }, [view]);

  // the race column covers the right of the map on wide screens
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setInset(el.offsetWidth + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!D]);   // eslint-disable-line react-hooks/exhaustive-deps

  const allCards = useMemo(() => cardSpecs(D, geo), [D, geo]);
  const cards = useMemo(() => visibleCards(allCards, view), [allCards, view]);
  const strip = useMemo(() => stripCards(allCards, D), [allCards, D]);
  const elected = useMemo(() => electedWards(D), [D]);
  const inBerkeley = view.level === "city" && view.id === HOME;

  const chosen = picked && picked.view === keyOf(view) ? picked.sel : null;
  const sel = chosen ?? defaultSelection(D, view, strip);
  const activeWard = useMemo(() => {   // the council district whose race was picked
    const r = chosen?.startsWith("race-") ? D?.races.find(x => "race-" + x.id === chosen) : undefined;
    return (r?.city === HOME && WARD_RE.exec(r.title)?.[1]) || null;
  }, [chosen, D]);

  const moveTo = useCallback((level: Level | "ward", id: string) => setCamera(c => ({ bbox: bboxOf(geo, level, id), seq: c.seq + 1 })), [geo]);
  const go = useCallback((level: Level, id: string) => {
    const v = normalizeView(geo, level, id);
    if (!v) return null;
    setView(prev => (prev.level === v.level && prev.id === v.id ? prev : v));
    moveTo(v.level, v.id);
    return v;
  }, [geo, moveTo]);

  const selectWard = useCallback((id: string) => {
    setView(prev => (prev.level === "city" && prev.id === HOME ? prev : { level: "city", id: HOME }));
    moveTo("ward", id);
    const r = D?.races.find(r => r.city === HOME && WARD_RE.exec(r.title)?.[1] === id);
    if (r) setPicked({ view: keyOf({ level: "city", id: HOME }), sel: "race-" + r.id });
  }, [D, moveTo]);

  // a card on the map: go to its area and show its race
  const onCard = useCallback((s: CardSpec) => {
    if (s.scope === "ward") return selectWard(s.area[1]);
    const v = view.level === s.go.level && view.id === s.go.id ? view : go(s.go.level, s.go.id);
    if (v && s.focus) setPicked({ view: keyOf(v), sel: s.focus });
  }, [view, go, selectWard]);

  // a card in Berkeley's strip: show its race without leaving Berkeley (council districts are framed on the map)
  const onStrip = useCallback((s: CardSpec) => {
    if (s.scope === "ward") return selectWard(s.area[1]);
    if (s.focus) setPicked({ view: keyOf(view), sel: s.focus });
  }, [view, selectWard]);

  const onZoomView = useCallback((v: View) => setView(v), []);

  const names = { city: chain.city ? nameOf(geo, "city", chain.city) : null, congress: null, county: nameOf(geo, "county", chain.county), state: S.california };
  const onLevel = (l: Level) => go(l, l === "city" ? chain.city : l === "county" ? chain.county : "CA");
  const right = window.innerWidth > 860 ? inset : 0;

  return (
    <>
      <TopBar feed={feed} view={view} names={names} onLevel={onLevel} />
      <div className="app">
        <section className="mapcol" aria-label={S.mapLabel}>
          <ErrorBoundary label={S.partMap}>
            <MapView geo={geo} view={view} camera={camera} cards={D ? cards : []} elected={elected} activeWard={activeWard} rightInset={inset} bottomInset={inBerkeley ? stripH : 0}
              onZoomView={onZoomView} onPick={go} onWard={selectWard} onCard={onCard} />
          </ErrorBoundary>
          <Legend />
          <RaceStrip cards={strip} selected={inBerkeley ? sel : null} activeWard={activeWard} rightInset={right} show={inBerkeley && strip.length > 0} onCard={onStrip} onHeight={setStripH} />
        </section>
        <div className="sidecol">
          <Banners feed={feed} />
          {D ? <ResultsPanel ref={panelRef} D={D} history={feed.history} sel={sel} ballot={ballot} />
            : <aside className="results" ref={panelRef}><p className="empty">{feed.error ?? S.loadingResults}</p></aside>}
        </div>
      </div>
    </>
  );
}
