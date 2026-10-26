import { api as omics } from "../omics/api";
import type { Detection } from "./detect";
import { navigate, omicsPath, type OmicsWorkflow } from "./router";

/**
 * Open omics data in its workbench. EEG goes through Sema's own session flow
 * (the launcher already has it); these two put files where the omics engine
 * reads them, make a run, and land on it.
 */

/** A sample: reuse the newest finished demo run if there is one, else build and start one. */
export async function openOmicsSample(wf: OmicsWorkflow): Promise<string> {
  const done = (await omics.runs()).find((r) => r.workflow === wf && r.source === "demo" && r.status === "done");
  if (done) {
    navigate(omicsPath(wf, done.id));
    return `Opened the ${wf === "bulk" ? "bulk RNA-seq" : "snRNA-seq"} sample`;
  }
  const have = await omics.inputs(wf);
  if (!have.demo.length) await omics.makeDemo(wf);
  const run = await omics.newRun(wf, "demo");
  await omics.execute(run.id, {});
  navigate(omicsPath(wf, run.id));
  return "Building the sample: the pipeline runs now, results appear as stages finish";
}

/** Dropped omics files: upload under their roles, make a run, land on it. */
export async function openOmicsFiles(d: Extract<Detection, { kind: "bulk" | "snrna" }>): Promise<string> {
  if (d.kind === "snrna") {
    await omics.upload("snrna", d.files, undefined, true);
  } else {
    let first = true;
    for (const { file, role } of d.files) {
      await omics.upload("bulk", [file], role, first);
      first = false;
    }
  }
  const wf: OmicsWorkflow = d.kind;
  if (d.kind === "bulk" && d.missing.length) {
    // nothing to run yet: open the bench with the Run tab, where the rest goes
    navigate(omicsPath(wf));
    return `Counts and metadata are both needed – add the ${d.missing.join(" and ")} in the Run tab (Your data)`;
  }
  const run = await omics.newRun(wf, "uploaded");
  navigate(omicsPath(wf, run.id));
  return "Inputs loaded – check the parameters, then Start";
}
