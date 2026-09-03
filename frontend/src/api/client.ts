// Typed fetch wrappers over the EEGvis backend. All calls go through the
// relative `/api` path — Vite proxies it in dev, same-origin in prod.

const BASE = "";

export interface SessionInfo {
  session_id: string;
  filename: string;
  channel_names: string[];
  channel_types: string[];
  channel_type_counts: Record<string, number>;
  n_channels: number;
  sfreq: number;
  n_times: number;
  duration_seconds: number;
  bads: string[];
  highpass: number | null;
  lowpass: number | null;
  has_montage: boolean;
  annotations: { onset: number; duration: number; description: string }[];
  meas_date: string | null;
}

/** The one wire shape every time-series panel parses. */
export interface Wire {
  channels: string[];
  sfreq: number;
  t0: number;
  dt: number;
  time: number[];
  data: Record<string, number[]>;
}

export interface OverviewResult {
  t: number[];
  rms: number[];
  duration: number;
}

export interface MontageLayout {
  channels: string[];
  pos2d: [number, number][];
  pos3d: [number, number, number][];
  has_montage: boolean;
}

export interface FieldResult {
  t: number;
  channels: string[];
  values: number[];
}

export interface ICAComponent {
  index: number;
  excluded: boolean;
  variance_explained: number | null;
}

export interface ICAComponentPSD {
  index: number;
  freqs: number[];
  psd_db: number[];
}

export interface PSDResult {
  freqs: number[];
  channels: string[];
  psd_db: number[][];
}

export interface BandPowerResult {
  channels: string[];
  bands: Record<string, number[]>;
}

export interface LedgerEntry {
  seq: number;
  op: string;
  params: Record<string, unknown>;
  label: string;
  rendered: string;
  template: string;
  ts: number;
  info_before: Record<string, unknown>;
  info_after: Record<string, unknown>;
  replayable: boolean;
}

export interface HistoryResult {
  entries: LedgerEntry[];
  montage_name: string | null;
  has_ica: boolean;
}

/** A node in the session's container graph (v2 — the left rail renders this). */
export interface ContainerRef {
  id: string;
  kind: "raw" | "epochs" | "evoked" | "spectrum" | "tfr" | "ica" | "forward" | "covariance" | "inverse" | "stc" | "dipole";
  label: string;
  parent_id: string | null;
  op_id: string | null;
  created_at: number;
}

export interface OpSchema {
  id: string;
  stage: string;
  label: string;
  inputs: string[];
  output: string | null;
  long_running: boolean;
  requires: string[];
  doc: string;
  params_schema: Record<string, unknown>;
}

/** Response of POST /sessions/{id}/ops for a synchronous op. */
export interface OpResult {
  op_id: string;
  graph: ContainerRef[];
  capabilities: string[];
  history: LedgerEntry[];
  session: SessionInfo;
}

/** Response of POST /sessions/{id}/ops for a long_running op (202). */
export interface OpJobHandle {
  op_id: string;
  job_id: string;
  state: string;
}

export interface Job {
  id: string;
  kind: string;
  session_id: string;
  state: "queued" | "running" | "done" | "error";
  progress: number;
  detail: string;
  error: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.name = "ApiError";
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = (body.detail as string) ?? detail;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 404 && /no session with id/i.test(detail)) {
      window.dispatchEvent(new CustomEvent("eegvis:session-lost"));
    }
    throw new ApiError(res.status, detail);
  }
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}

const j = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
  // --- session lifecycle ---
  demo: () => req<SessionInfo>("/api/sessions/demo", { method: "POST" }),
  uploadFile: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return req<SessionInfo>("/api/sessions/upload", { method: "POST", body: form });
  },
  getSession: (id: string) => req<SessionInfo>(`/api/sessions/${id}`),
  deleteSession: (id: string) => req<void>(`/api/sessions/${id}`, { method: "DELETE" }),

  // --- viewer / geometry ---
  window: (id: string, p: { start: number; duration: number; channels?: string[]; max_points?: number }) =>
    req<Wire>(`/api/sessions/${id}/viewer/window`, j(p)),
  overview: (id: string, nBins = 1200) =>
    req<OverviewResult>(`/api/sessions/${id}/viewer/overview?n_bins=${nBins}`),
  montageLayout: (id: string) => req<MontageLayout>(`/api/sessions/${id}/montage/layout`),
  field: (id: string, t: number, channels?: string[]) =>
    req<FieldResult>(`/api/sessions/${id}/viewer/field`, j({ t, channels })),

  // --- preprocessing (each records a ledger step) ---
  bandpass: (id: string, l_freq: number | null, h_freq: number | null) =>
    req<SessionInfo>(`/api/sessions/${id}/preprocessing/bandpass`, j({ l_freq, h_freq })),
  notch: (id: string, freqs: number[]) =>
    req<SessionInfo>(`/api/sessions/${id}/preprocessing/notch`, j({ freqs })),
  resample: (id: string, sfreq: number) =>
    req<SessionInfo>(`/api/sessions/${id}/preprocessing/resample`, j({ sfreq })),
  setBads: (id: string, bads: string[]) =>
    req<SessionInfo>(`/api/sessions/${id}/preprocessing/bad-channels`, j({ bads })),
  setReference: (id: string, ref_channels: string | string[] = "average") =>
    req<SessionInfo>(`/api/sessions/${id}/preprocessing/reference`, j({ ref_channels })),
  setMontage: (id: string, montage_name = "standard_1020") =>
    req<SessionInfo>(`/api/sessions/${id}/preprocessing/montage`, j({ montage_name })),

  // --- provenance ---
  history: (id: string) => req<HistoryResult>(`/api/sessions/${id}/history`),
  revert: (id: string, to_seq: number) =>
    req<SessionInfo>(`/api/sessions/${id}/revert`, j({ to_seq })),

  // --- operations (v2 registry — one endpoint for every MNE op) ---
  listOps: (input?: string) =>
    req<{ operations: OpSchema[] }>(`/api/ops${input ? `?input=${input}` : ""}`),
  runOp: (id: string, op_id: string, params: Record<string, unknown> = {}) =>
    req<OpResult | OpJobHandle>(`/api/sessions/${id}/ops`, j({ op_id, params })),
  graph: (id: string) =>
    req<{ graph: ContainerRef[]; capabilities: string[] }>(`/api/sessions/${id}/graph`),
  getJob: (jobId: string) => req<Job>(`/api/jobs/${jobId}`),
  sessionJobs: (id: string) => req<{ jobs: Job[] }>(`/api/sessions/${id}/jobs`),

  // --- ICA ---
  fitIca: (id: string, n_components: number, method = "fastica") =>
    req<{ n_components: number; components: ICAComponent[] }>(`/api/sessions/${id}/ica/fit`, j({ n_components, method })),
  icaComponents: (id: string) => req<{ components: ICAComponent[] }>(`/api/sessions/${id}/ica/components`),
  icaTopomap: (id: string, index: number) =>
    req<{ index: number; png_base64: string }>(`/api/sessions/${id}/ica/components/${index}/topomap`),
  icaExclude: (id: string, exclude: number[]) =>
    req<{ components: ICAComponent[] }>(`/api/sessions/${id}/ica/exclude`, j({ exclude })),
  icaSources: (id: string, p: { start: number; duration: number; max_points?: number }) =>
    req<Wire>(`/api/sessions/${id}/ica/sources`, j(p)),
  icaComponentPsd: (id: string, index: number) =>
    req<ICAComponentPSD>(`/api/sessions/${id}/ica/components/${index}/psd`),
  applyIca: (id: string) => req<{ applied: boolean; excluded: number[] }>(`/api/sessions/${id}/ica/apply`, { method: "POST" }),

  // --- spectral ---
  psd: (id: string, fmin = 1, fmax = 45, channels?: string[]) =>
    req<PSDResult>(`/api/sessions/${id}/spectral/psd`, j({ fmin, fmax, channels })),
  bandPower: (id: string) => req<BandPowerResult>(`/api/sessions/${id}/spectral/band-power`),
  bandTopomap: (id: string, band: string, channels?: string[]) =>
    req<{ band: string; png_base64: string }>(`/api/sessions/${id}/spectral/band-topomap`, j({ band, channels })),

  // --- export (URLs for <a download>) ---
  exportRawUrl: (id: string) => `${BASE}/api/sessions/${id}/export/raw.fif`,
  exportPipelineUrl: (id: string) => `${BASE}/api/sessions/${id}/export/pipeline.py`,
  exportSummaryUrl: (id: string) => `${BASE}/api/sessions/${id}/export/summary.csv`,
  pipelineText: (id: string) => req<string>(`/api/sessions/${id}/export/pipeline.py`),
};
