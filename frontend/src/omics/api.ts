// Every call goes through the relative /api path: Vite proxies it in dev, the
// backend serves the built UI from the same origin otherwise.

export type Kind = "bool" | "int" | "float" | "str" | "list";
export type Value = boolean | number | string | (string | number)[];
export type WorkflowId = "bulk" | "snrna";
export type Engine = "python" | "R" | "notebook";

export interface Param { name: string; type: Kind; default: Value; help: string; group: string }
export interface Stage { id: string; title: string; summary: string; cells: number[]; engines: Engine[] }
export interface Workflow {
  id: WorkflowId; name: string; gloss: string; title: string; engines: Engine[];
  design: string; stages: Stage[]; params: Param[];
}
export type StageState = "pending" | "running" | "done" | "failed";
export interface LedgerEntry {
  n: number; started: string; finished?: string; seconds?: number; engine?: Engine;
  params: Record<string, Value>; stages: [string, string]; status: string; source: string;
}
export interface RunMeta {
  id: string; workflow: WorkflowId; engine: Engine; source: "demo" | "uploaded"; label: string; created: string;
  status: "idle" | "running" | "done" | "failed" | "cancelled";
  stages: Record<string, StageState>; ledger: LedgerEntry[]; active?: boolean;
}
export interface RunSummary { id: string; workflow: WorkflowId; engine: Engine; created: string; status: RunMeta["status"]; source: string; label: string }
export interface Caps { rscript: string | null; python: Record<string, string | null> }
export interface InputFile { name: string; bytes: number }
export interface FigureRef { id: string; title: string; kind: string; note: string; variants: string[] }
export interface FileRef { path: string; bytes: number }
export interface NounEntry {
  id: string; label: string; icon: string; hint: string;
  figures: FigureRef[]; static: string[]; tables: FileRef[]; downloads: FileRef[];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Spec = Record<string, any> & { kind: string; title: string; id: string; noun: string; variants?: string[] };
export type LiveResult = Spec & { exact: boolean; ms: number; counts?: Record<string, number>; matched?: number; groupTest?: Spec; summary?: Record<string, any>; job?: string; spec?: LiveResult };
export type JobStatus = { id: string; status: "queued" | "running" | "done" | "error"; history: string[]; spec?: LiveResult; error?: string; detail?: string };

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${OMICS}${path}`, init);
  if (!r.ok) {
    let msg = `${r.status}`;
    try { msg = (await r.json()).detail ?? msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return r.json();
}
const post = <T,>(path: string, body?: unknown) =>
  j<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

/** The omics sub-app, on Sema's API origin (see api/client.ts). */
const OMICS = `${(import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "")}/omics/api`;

const qs = (o: Record<string, string | undefined | null>) => {
  const p = Object.entries(o).filter(([, v]) => v != null && v !== "") as [string, string][];
  return p.length ? `?${new URLSearchParams(p)}` : "";
};

export const api = {
  caps: () => j<Caps>("/capabilities"),
  workflows: () => j<Workflow[]>("/workflows"),
  source: (wf: string, sid: string, engine?: string) =>
    fetch(`${OMICS}/workflows/${wf}/stages/${sid}/source${qs({ engine })}`).then((r) => r.text()),
  inputs: (wf: string) => j<{ uploaded: InputFile[]; demo: InputFile[] }>(`/inputs/${wf}`),
  design: (wf: string, source: string) => j<{ samples: Record<string, string>[]; columns: string[] }>(`/inputs/${wf}/design${qs({ source })}`),
  makeDemo: (wf: string) => post<{ demo: InputFile[] }>(`/inputs/${wf}/demo`),
  upload: (wf: string, files: FileList | File[], role?: string, replace?: boolean) => {
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("files", f);
    return j<{ uploaded: InputFile[] }>(`/inputs/${wf}${qs({ role, replace: replace ? "true" : undefined })}`, { method: "POST", body: fd });
  },
  runs: () => j<RunSummary[]>("/runs"),
  newRun: (workflow: string, source: string, engine?: string) => post<RunMeta>("/runs", { workflow, source, engine }),
  run: (id: string) => j<RunMeta>(`/runs/${id}`),
  execute: (id: string, params: Record<string, Value>, stage_from?: string, stage_to?: string) =>
    post<RunMeta>(`/runs/${id}/execute`, { params, stage_from, stage_to }),
  cancel: (id: string) => post<{ cancelled: boolean }>(`/runs/${id}/cancel`),
  remove: (id: string) => j(`/runs/${id}`, { method: "DELETE" }),
  log: (id: string, offset: number) => j<{ text: string; offset: number }>(`/runs/${id}/log?offset=${offset}`),
  catalogue: (id: string) => j<NounEntry[]>(`/runs/${id}/figures`),
  figure: (id: string, noun: string, fig: string, variant?: string, gene?: string) =>
    j<Spec>(`/runs/${id}/figures/${noun}/${fig}${qs({ variant, gene })}`),
  // – live compute (L1): every response is a figures.py spec + exact + ms –
  live: (id: string, op: string, body?: unknown) => post<LiveResult>(`/runs/${id}/live/${op}`, body),
  job: (id: string, jobId: string) => j<JobStatus>(`/runs/${id}/live/jobs/${jobId}`),
  fileUrl: (id: string, path: string) => `${OMICS}/runs/${id}/file/${path.split("/").map(encodeURIComponent).join("/")}`,
  exportUrl: (id: string, entry?: number) => `${OMICS}/runs/${id}/export${qs({ entry: entry ? String(entry) : undefined })}`,
};

export const fmtBytes = (n: number) => n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${(n / 1e3).toFixed(0)} kB` : `${n} B`;
export const stageNum = (id: string) => id.slice(0, 3).replace("_", "");
