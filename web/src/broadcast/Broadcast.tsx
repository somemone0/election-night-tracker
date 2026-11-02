// The Instagram Live loop: a 1080x1920 page that cycles through the slides in slides.ts, after the Daily Cal's
// "dc26 full cycle" video and set like the website (chalkboard black, Tiempos and Plantin, hairline rules). Each slide's
// rows come in one after another with their numbers counting up; the tabs under the logo show where the loop is. OBS captures it as a browser source (see README, "Instagram Live").
//
// URL options: ?slide=2 holds one slide (for checking a layout), ?seconds=5 changes the slide length, ?still=1 turns
// off the animation (for screenshots and static graphics). Clicking a tab jumps to that slide (for checking layouts).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useBallot } from "../hooks/useBallot";
import { useResults } from "../hooks/useResults";
import { DISTRICT_COLORS } from "../config";
import { apTime } from "../lib/format";
import { type BigBlock, type Block, type BroadcastConfig, buildSlides, type CandBlock, DEFAULT_CONFIG, type MeasureBlock } from "./slides";
import { S } from "../strings";

const W = 1080, H = 1920;
const ROW_GAP_MS = 130, FIRST_ROW_MS = 200, LEAVE_MS = 450, COUNT_MS = 900;
const params = new URLSearchParams(location.search);
const STILL = params.has("still");

function useConfig(): BroadcastConfig {
  const [cfg, setCfg] = useState(DEFAULT_CONFIG);
  useEffect(() => {
    const load = () => fetch(`broadcast.json?t=${Date.now()}`, { cache: "no-store" }).then(r => (r.ok ? r.json() : {})).then((j: Partial<Record<keyof BroadcastConfig, any>>) => setCfg({
      slideSeconds: Number(j.slideSeconds) > 2 ? Number(j.slideSeconds) : DEFAULT_CONFIG.slideSeconds,
      stateProps: Array.isArray(j.stateProps) ? j.stateProps.map(String) : DEFAULT_CONFIG.stateProps,
      parties: j.parties && typeof j.parties === "object" ? j.parties : {},
    })).catch(() => {});
    load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, []);
  return cfg;
}

/** Counts up from 0 when it appears (after `delay`), and from the old value when the number changes. */
function Num({ value, delay = 0, d = 1, suffix = "%", sign = false }: { value: number; delay?: number; d?: number; suffix?: string; sign?: boolean }) {
  const [v, setV] = useState(STILL ? value : 0);
  const from = useRef(0), first = useRef(true);
  useEffect(() => {
    if (STILL) { setV(value); return; }
    let raf = 0;
    const a = from.current, b = value, start = performance.now() + (first.current ? delay : 0);
    first.current = false;
    const step = (t: number) => {
      const k = Math.max(0, Math.min(1, (t - start) / COUNT_MS)), x = a + (b - a) * (1 - (1 - k) ** 3);
      from.current = x; setV(x);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);   // eslint-disable-line react-hooks/exhaustive-deps
  return <>{sign ? "+" : ""}{v.toFixed(d)}{suffix}</>;
}

const Check = () => <span className="ck" aria-label={S.called}>✓</span>;
const inText = (p: number | null) => (p == null ? null : S.bc.reporting(Math.round(p)));

function Cands({ b, delay }: { b: CandBlock; delay: number }) {
  return (
    <div className={"cb" + (b.small ? " small" : "") + (b.title.length > 10 ? " longt" : "") + (b.ward ? " district" : "")} style={b.ward ? { ["--dc" as any]: DISTRICT_COLORS[b.ward]?.fill } : undefined}>
      <div className="ct">
        <div className="tt">{b.title}</div>
        {inText(b.pctIn) && <div className="meta">{inText(b.pctIn)}</div>}
        {b.seats > 1 && <div className="meta">{S.bc.seats(b.seats)}</div>}
      </div>
      <div className="cl">
        {b.cands.map((c, k) => (
          <div key={c.name} className="crw">
            {b.cut && k === b.seats && <div className="cut"><span>{b.cut}</span></div>}
            <div className={`cr ${c.win ? "lead" : "trail"}${k === 0 && !b.small ? " first" : ""}${c.name.length > 15 ? " long" : ""}`}>
              <span className="nm">{c.win && b.called ? <Check /> : null}{c.name}{b.partisan && c.party ? <span className="pty"> ({c.party})</span> : null}</span>
              <span className="pc">{b.counted ? <Num value={c.pct} delay={delay} /> : S.none}</span>
              <span className="mg">{k === 0 && b.margin != null ? <Num value={b.margin} delay={delay} sign suffix="" /> : null}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Measure({ b, delay }: { b: MeasureBlock; delay: number }) {
  return (
    <div className="mb">
      <div className="lt">{b.letter}</div>
      <div className="mid">
        <div className="lbl">{b.label}</div>
        <div className="bar"><i style={{ width: (b.counted ? b.yes : 0) + "%", animationDelay: delay + "ms" }} /><b style={{ left: b.th + "%" }} /></div>
      </div>
      <div className="rv">
        <div className="yes"><small>{S.yes}</small>{b.counted ? <Num value={b.yes} delay={delay} /> : S.none}</div>
        <div className="needs">{b.called ? <><Check />{b.yes >= b.th ? S.passes : S.fails}</> : S.needs(b.needs)}</div>
      </div>
    </div>
  );
}

function Big({ b, delay }: { b: BigBlock; delay: number }) {
  return (
    <div className="bb">
      <div className="bh"><span className="tt">{b.title}</span><span className="box">{b.called ? <><Check />{b.yes >= b.th ? S.passes : S.fails}</> : S.needs(b.needs)}</span></div>
      {b.label && <div className="lbl">{b.label}</div>}
      <div className="yn">
        <span className="y"><small>{S.yes}</small>{b.counted ? <Num value={b.yes} delay={delay} /> : S.none}</span>
        <span className="maj" style={{ left: b.th + "%" }}>{b.th > 60 ? S.bc.twoThirdsTick : S.bc.majorityTick}</span>
        <span className="n"><small>{S.no}</small>{b.counted ? <Num value={b.no} delay={delay} /> : S.none}</span>
      </div>
      <div className="bar big"><i style={{ width: (b.counted ? b.yes : 0) + "%", animationDelay: delay + "ms" }} /><b style={{ left: b.th + "%" }} /></div>
      {inText(b.pctIn) && <div className="meta">{inText(b.pctIn)}</div>}
    </div>
  );
}

function BlockView({ b, delay }: { b: Block; delay: number }) {
  return b.kind === "cands" ? <Cands b={b} delay={delay} /> : b.kind === "measure" ? <Measure b={b} delay={delay} /> : <Big b={b} delay={delay} />;
}

export function Broadcast() {
  const feed = useResults(), ballot = useBallot(), cfg = useConfig();
  const slides = useMemo(() => buildSlides(feed.data, ballot, cfg), [feed.data, ballot, cfg]);
  const hold = params.get("slide");
  const ms = (Number(params.get("seconds")) || cfg.slideSeconds) * 1000;
  const [step, setStep] = useState(0);          // how many slides have been shown; the slide is step % slides.length
  const [leaving, setLeaving] = useState(false);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {   // fit the 1080x1920 stage in the window (OBS uses exactly 1080x1920, so scale 1)
    const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit(); window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    if (hold != null || slides.length < 2) return;
    const a = window.setTimeout(() => setLeaving(true), ms - LEAVE_MS);
    const b = window.setTimeout(() => { setLeaving(false); setStep(s => s + 1); }, ms);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [step, slides.length, ms, hold]);

  if (!slides.length) return <div className="bc-fit"><div className="stage wait" style={{ transform: `scale(${scale})` }}>{feed.error ?? S.loadingResults}</div></div>;
  const idx = hold != null ? Math.abs(Number(hold) || 0) % slides.length : step % slides.length;
  const cur = slides[idx];
  const updated = feed.data ? apTime(new Date(feed.data.generated_at)) : "";

  return (
    <div className="bc-fit">
      <div className={"stage" + (STILL ? " still" : "")} style={{ transform: `scale(${scale})`, ["--slide" as any]: ms + "ms" }}>
        <header>
          <div className="mast">
            <img src="img/dc-logo.png" alt={S.paper} /><span className="yr">{S.bc.year}</span>
          </div>
          <nav className="tabs" aria-hidden="true">{slides.map((s, k) => (
            <span key={s.key} className={k === idx ? "on" : ""} onClick={() => { setLeaving(false); setStep(st => st + ((k - (st % slides.length) + slides.length) % slides.length || slides.length)); }}>{s.tab}{k === idx && <i key={step} className={hold != null ? "full" : "run"} />}</span>
          ))}</nav>
        </header>
        <main className={"content" + (leaving ? " out" : "")} key={cur.key + ":" + step}>
          {cur.note && <div className="note">{cur.note}</div>}
          {cur.blocks.map((b, j) => {
            const delay = FIRST_ROW_MS + j * ROW_GAP_MS;
            return <div key={b.key} className={"blk " + b.kind} style={{ animationDelay: delay + "ms" }}><BlockView b={b} delay={delay} /></div>;
          })}
          <div className="foot" style={{ animationDelay: FIRST_ROW_MS + cur.blocks.length * ROW_GAP_MS + "ms" }}>{S.bc.footer(updated.replace(/\.$/, ""))}</div>
        </main>
      </div>
    </div>
  );
}
