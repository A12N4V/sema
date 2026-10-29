import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { BookOpen, TriangleAlert } from "lucide-react";
import { api, type Value } from "../api";
import { NO_EDITS, useStore, useWorkflow } from "../store";

/**
 * What the statistics can actually see. Both workflows test THC against vehicle
 * with the animal as the unit, so the card counts animals, not genes or nuclei,
 * and follows the parameters live: drop a sample or add a covariate and the
 * residual df moves before anything runs. Formulas: docs/FORMAT_*.md.
 */
const DOCS = "https://github.com/A12N4V/sema/blob/main/docs/";

const choose = (n: number, k: number) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r); };
const list = (v: Value | undefined) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

export function Design() {
  const wf = useWorkflow()!;
  const edits = useStore((s) => s.edits[s.wfId]) ?? NO_EDITS;
  const source = useStore((s) => s.run?.source ?? "demo");
  const val = (name: string) => edits[name] ?? wf.params.find((p) => p.name === name)?.default;
  const [sheet, setSheet] = useState<Record<string, string>[]>([]);
  const [cols, setCols] = useState<string[]>([]);
  useEffect(() => {
    if (wf.id !== "bulk") return;
    let live = true;
    api.design(wf.id, source).then((d) => { if (live) { setSheet(d.samples); setCols(d.columns); } })
      .catch(() => { if (live) { setSheet([]); setCols([]); } });
    return () => { live = false; };
  }, [wf.id, source]);

  let rows: [string, string][], warn: string | null = null, unit: string, doc: string;
  if (wf.id === "bulk") {
    const gcol = String(val("GROUP_COL") ?? "group"), ref = String(val("GROUP_REF")), test = String(val("GROUP_TEST"));
    const excl = new Set(list(val("EXCLUDE"))), covars = list(val("COVARS"));
    const kept = sheet.filter((r) => !excl.has(r.sample));
    const nRef = kept.filter((r) => r[gcol] === ref).length, nTest = kept.filter((r) => r[gcol] === test).length;
    const p = 2 + covars.length, df = nRef + nTest - p;
    unit = "animal"; doc = "FORMAT_BULK_RNASEQ.md";
    rows = [
      ["contrast", `${test} vs ${ref}  ·  log2FC > 0 = up in ${test}`],
      ["animals", sheet.length ? `${nTest} ${test} · ${nRef} ${ref}${excl.size ? `  (excl. ${[...excl].join(", ")})` : ""}` : "no sample sheet yet"],
      ["model", `~ ${[...covars, gcol].join(" + ")}  ·  ${p} coefficients`],
      ["residual df", sheet.length ? `${df} per gene, then shrunk across genes` : "—"],
    ];
    const missing = covars.filter((c) => cols.length && !cols.includes(c));
    if (missing.length) warn = `not in the sample sheet: ${missing.join(", ")} (columns: ${cols.join(", ")})`;
    else if (sheet.length && (nRef < 2 || nTest < 2)) warn = "a group has fewer than 2 animals: nothing can be tested";
    else if (sheet.length && df < 3) warn = `only ${df} residual df: estimates lean almost entirely on the dispersion prior`;
  } else {
    const animals = list(val("SAMPLES"));
    const thc = animals.filter((a) => /^THC/i.test(a)).length, veh = animals.length - thc;
    const minPer = Number(val("MIN_SAMPLES_PER_GROUP") ?? 3);
    const perms = choose(animals.length, thc);
    const pmin = (thc === veh ? 2 : 1) / perms;
    unit = "animal, never the nucleus"; doc = "FORMAT_SNRNASEQ.md";
    rows = [
      ["contrast", "THC vs VEH  ·  log2FC > 0 = up in THC"],
      ["animals", `${thc} THC · ${veh} VEH  ·  one library each`],
      ["DE", `pseudobulk per animal × cell type  ·  df ≤ ${Math.max(0, animals.length - 2)}`],
      ["composition", `exact permutation over ${perms} labelings  ·  smallest p ${pmin.toFixed(3)}`],
    ];
    if (Math.min(thc, veh) < minPer) warn = `fewer than MIN_SAMPLES_PER_GROUP=${minPer} animals in a group: every cell type will be ineligible`;
  }

  return (
    <section aria-label="Design" className="border-b border-seam px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="flex-1 text-2xs uppercase tracking-[0.12em] text-fg-faint">Design</h3>
        <a href={DOCS + doc} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-2xs text-fg-faint hover:text-accent" title="The format, its degrees of freedom and the maths">
          <BookOpen size={10} /> method
        </a>
      </div>
      <p className="mb-1.5 text-2xs text-fg-dim">unit of inference: <span className="text-accent">{unit}</span></p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-2xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-faint">{k}</dt>
            <dd className="mono min-w-0 break-words text-fg-dim">{v}</dd>
          </div>
        ))}
      </dl>
      {warn && (
        <p role="status" className={clsx("mt-1.5 flex items-start gap-1 text-2xs leading-snug text-warn")}>
          <TriangleAlert size={11} className="mt-px shrink-0" /> {warn}
        </p>
      )}
    </section>
  );
}

/**
 * The analyst choices that move the result most (docs/FORMAT_*.md §2c). Marked
 * in the parameter list so a reader sees which knobs are forks in the path.
 */
export const FORKS: Record<string, string> = {
  EXCLUDE: "Which animals count. Pre-register it; the sensitivity run shows what changes without it.",
  COVARS: "Each covariate costs one residual df and must be a complete column of the sample sheet.",
  FILTER_MIN: "The low-count filter changes the gene universe, and with it the BH correction and enrichment background.",
  FDR: "The primary threshold. Hits between this and P_NOMINAL are exploratory, not findings.",
  LFC_MIN: "A post-hoc |log2FC| cut, not a test of |LFC| > threshold.",
  PROTEIN_CODING_ONLY: "Changes the background for GO ORA and GSEA.",
  MIN_GENES: "Floor for empty or broken nuclei; too high removes small cell types first.",
  MAX_PCT_MT: "Nuclei should carry little mitochondrial RNA; a high fraction means cytoplasmic carry-over.",
  UPPER_MAD: "Per-animal ceiling against doublets and clumps, on a log scale.",
  BROAD_RESOLUTION: "Leiden resolution: the largest fork in clustering. The sweep shows how stable the clusters are.",
  USE_HARMONY: "Integration only changes the embedding; pseudobulk DE always uses raw counts.",
  AUTO_LABEL_MIN_PROB: "Below this a cluster stays Unannotated rather than being forced into a type.",
  MIN_NUCLEI_PER_SAMPLE_TYPE: "Which animal × type pseudobulks qualify; decides which cell types are tested at all.",
  MIN_SAMPLES_PER_GROUP: "A cell type needs this many qualifying animals per group to be tested.",
};
