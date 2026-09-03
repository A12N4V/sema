// Shared mutation helper: run an API call that changes the session, then
// refresh everything that depends on it (session info, ledger, montage
// geometry) and surface a toast. Every clickable control in the toolbar
// goes through here so the ledger and the panels stay in lockstep.
import { toast } from "sonner";
import { api, type Job, type SessionInfo } from "../api/client";
import { store } from "../store/store";

/** Poll a job to completion. Resolves on "done", throws on "error". */
export async function pollJob(jobId: string, onTick?: (j: Job) => void): Promise<Job> {
  for (;;) {
    const jb = await api.getJob(jobId);
    onTick?.(jb);
    if (jb.state === "done") return jb;
    if (jb.state === "error") throw new Error(jb.error ?? "operation failed");
    await new Promise((r) => setTimeout(r, 400));
  }
}

export async function applyOp(
  run: () => Promise<SessionInfo>,
  successMsg: string,
): Promise<void> {
  try {
    const info = await run();
    store().patchSession(info);
    await Promise.all([store().refreshHistory(), store().loadLayout(), store().refreshGraph()]);
    toast.success(successMsg);
  } catch (e) {
    toast.error((e as Error).message);
    throw e;
  }
}

/** Run an operation-registry op (v2 generic dispatch) and fold the result
 *  into the store. Same post-conditions as applyOp. */
export async function runOp(
  opId: string,
  params: Record<string, unknown>,
  successMsg: string,
  onTick?: (j: Job) => void,
): Promise<void> {
  const id = store().session?.session_id;
  if (!id) return;
  try {
    const res = await api.runOp(id, opId, params);
    if ("job_id" in res) {
      await pollJob(res.job_id, onTick);
      store().patchSession(await api.getSession(id));
    } else {
      store().patchSession(res.session);
    }
    await Promise.all([store().refreshHistory(), store().loadLayout(), store().refreshGraph()]);
    toast.success(successMsg);
  } catch (e) {
    toast.error((e as Error).message);
    throw e;
  }
}

/** Standard montages worth offering in the Montage control. */
export const MONTAGES = [
  "standard_1020",
  "standard_1005",
  "biosemi32",
  "biosemi64",
  "biosemi128",
  "easycap-M1",
  "GSN-HydroCel-128",
] as const;

export function parseTime(s: string): number {
  if (s.includes(":")) {
    const [m, sec] = s.split(":");
    return Number(m) * 60 + Number(sec);
  }
  return Number(s);
}
