// Shapes of the files the tracker writes (site/data/results.json, history.json) and the boundaries in site/geo.

export interface Precincts { done: number; total: number; pct: number }

/** A race call (see calls.py): an editor's desk call, or decided by the count (the trailing side cannot catch up). */
export interface Call { winners: string[]; how: "desk" | "decided"; at: string }

export interface MeasureCount {
  yes: number; no: number; yes_pct: number; no_pct: number;
  leader: "yes" | "no" | "tied" | null; margin: number;
  total?: number; precincts?: Precincts | null; call?: Call;
}

export interface Row { name: string; votes: number; pct: number; party?: string }

interface RaceBase {
  id: string;
  group: "city" | "congress" | "county" | "turnout";
  city: string | null; cd: number | string | null;
  category?: string | null; subcategory?: string | null;
  title: string; rcv: boolean; rule: string | null;
  precincts: Precincts | null; total: number; seats?: number; call?: Call;
}
export interface CandidateRace extends RaceBase { kind: "candidate"; rows: Row[] }
export interface MeasureRace extends RaceBase, Omit<MeasureCount, "total" | "precincts"> { kind: "measure"; rows?: Row[] }
export type Race = CandidateRace | MeasureRace;

export interface Contest { title: string; candidates: Row[]; total: number; precincts: Precincts | null; reporting_time?: string; call?: Call }

export interface RtmCounty {
  county: string; yes: number; no: number; yes_pct: number; no_pct: number;
  precincts: Precincts | null; source: string | null; status: "ok" | "manual" | "waiting" | "error"; note: string | null;
}
export interface Rtm {
  counties: RtmCounty[]; total: MeasureCount & { total: number }; rule: string;
  counties_in: number; counties_counting: number; complete: boolean; at: string;
}

export interface SourceMeta { ok?: boolean; stale?: boolean; reporting_time?: string; updated?: string; roster_only?: boolean; title?: string; precincts?: Precincts }

export interface Results {
  generated_at: string;
  headline: { number: string; name: string; state: MeasureCount | null; alameda: MeasureCount | null };
  state_measures: { number: string; name: string; state: MeasureCount; alameda: MeasureCount | null }[];
  contests?: { governor?: { state?: Contest | null; alameda?: Contest | null } };
  races: Race[];
  rtm?: Rtm | null;
  meta: {
    mock?: boolean; warnings?: string[]; errors?: string[];
    sos_state: SourceMeta; sos_alameda?: SourceMeta; alameda: SourceMeta; gov_state?: SourceMeta; gov_alameda?: SourceMeta;
    [k: string]: unknown;
  };
}

export interface HistoryPoint { t: string; sos_time?: string; state_yes_pct: number | null; [k: string]: unknown }

export type Level = "city" | "congress" | "county" | "state";
export interface View { level: Level; id: string }

export type BBox = [number, number, number, number];
export interface AreaProps { level: string; id: string; name: string; bbox: BBox }
export interface Area { type: "Feature"; properties: AreaProps; geometry: { type: "Polygon" | "MultiPolygon"; coordinates: any } }
export interface AreaCollection { type: "FeatureCollection"; features: Area[] }
export interface Geo { state: AreaCollection; county: AreaCollection; congress: AreaCollection; city: AreaCollection; cityAll: AreaCollection; ward: AreaCollection }
