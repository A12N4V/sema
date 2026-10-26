/**
 * What did the user drop? One answer per drop, so the launcher can open the
 * workbench that fits the data instead of asking which one they meant.
 *
 *   eeg     anything MNE reads (EDF, BDF, FIF, BrainVision, EEGLAB, …)  → Sema
 *   bulk    a gene × sample counts table, optionally its metadata sheet → Plethos
 *   snrna   per-sample CellBender / 10x .h5, .h5ad, or a 10x mtx triplet → Karyon
 *
 * Extensions decide most cases. The two that need a look inside are the
 * tables (counts vs metadata vs signatures share .csv/.tsv/.xls) and HDF5,
 * which both SNIRF (fNIRS, Sema) and the single-cell formats use.
 */
export type DataKind = "eeg" | "bulk" | "snrna";
export type BulkRole = "counts" | "metadata" | "signatures";

export type Detection =
  | { kind: "eeg"; file: File }
  | { kind: "bulk"; files: { file: File; role: BulkRole }[]; missing: BulkRole[] }
  | { kind: "snrna"; files: File[] }
  | { kind: "unknown"; reason: string };

const EEG_EXT = [
  ".edf", ".bdf", ".gdf", ".fif", ".fif.gz", ".vhdr", ".set", ".cnt", ".mff", ".snirf", ".ds",
  ".con", ".sqd", ".mrk", ".egi", ".raw", ".lay", ".dat", ".cdt", ".asc", ".nxe", ".mef", ".xdf",
];
const SC_EXT = [".h5ad", ".loom", ".mtx", ".mtx.gz", ".h5"];
const TABLE_EXT = [".csv", ".tsv", ".txt", ".xls", ".xlsx", ".tab", ".csv.gz", ".tsv.gz"];
const SIGNATURES = new Set(["DG_cell_type_signatures.csv", "targeted_axes_signatures.csv"]);

const ext = (name: string) => {
  const n = name.toLowerCase();
  return [...EEG_EXT, ...SC_EXT, ...TABLE_EXT].filter((e) => n.endsWith(e)).sort((a, b) => b.length - a.length)[0] ?? "";
};

/** First line of a text table, split on its own delimiter. */
async function header(file: File): Promise<string[] | null> {
  const head = await file.slice(0, 64 * 1024).text();
  if (/[\u0000-\u0008]/.test(head.slice(0, 512))) return null;   // binary: a real .xls/.xlsx
  const lines = head.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const sep = (lines[0].match(/\t/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? "\t" : ",";
  return lines[0].split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
}

/** Second line, same delimiter as the first: is it mostly numbers? */
async function numericShare(file: File): Promise<number> {
  const lines = (await file.slice(0, 64 * 1024).text()).split(/\r?\n/).filter((l) => l.trim());
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const cells = (lines[1] ?? "").split(sep).slice(1);
  return cells.length ? cells.filter((c) => c.trim() !== "" && !isNaN(Number(c))).length / cells.length : 0;
}

const GENE_COL = /^(gene(_?id|_?name|_?symbol)?|geneid|ensembl(_?id)?|symbol|id|name|feature(_?id)?)$/i;
const META_COL = /^(sample(_?id|_?name)?|group|condition|treatment|batch|sex|genotype|replicate)$/i;

/** counts · metadata · signatures, or null when it is a table of something else. */
export async function tableRole(file: File): Promise<BulkRole | null> {
  if (SIGNATURES.has(file.name)) return "signatures";
  const cols = await header(file);
  if (!cols) {
    // binary Excel: decide by name, the content needs a parser we do not ship
    if (/meta|sample|design|coldata/i.test(file.name)) return "metadata";
    if (/count|matrix|expr|gene/i.test(file.name)) return "counts";
    return null;
  }
  const metaHits = cols.filter((c) => META_COL.test(c)).length;
  if (metaHits >= 2 || (metaHits >= 1 && cols.length <= 8)) return "metadata";
  if (GENE_COL.test(cols[0]) || cols.length > 4) return (await numericShare(file)) > 0.5 ? "counts" : null;
  return null;
}

/** HDF5 signature: 0x89 'HDF' \r \n 0x1a \n. */
export async function isHdf5(file: File): Promise<boolean> {
  const b = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v);
}

export async function detect(files: File[]): Promise<Detection> {
  if (!files.length) return { kind: "unknown", reason: "nothing dropped" };
  const byExt = files.map((f) => ({ f, e: ext(f.name) }));

  const eeg = byExt.find(({ e }) => EEG_EXT.includes(e));
  if (eeg) return { kind: "eeg", file: eeg.f };

  const sc = byExt.filter(({ e }) => SC_EXT.includes(e));
  if (sc.length) {
    // .h5 is HDF5 for 10x and CellBender alike; anything else under that name is a mislabel
    for (const { f, e } of sc) {
      if ((e === ".h5" || e === ".h5ad") && !(await isHdf5(f))) return { kind: "unknown", reason: `${f.name} is not HDF5` };
    }
    return { kind: "snrna", files: sc.map(({ f }) => f) };
  }

  const tables = byExt.filter(({ e }) => TABLE_EXT.includes(e));
  if (tables.length) {
    const roles: { file: File; role: BulkRole }[] = [];
    for (const { f } of tables) {
      const role = await tableRole(f);
      if (role) roles.push({ file: f, role });
    }
    if (roles.some((r) => r.role === "counts" || r.role === "metadata")) {
      const have = new Set(roles.map((r) => r.role));
      return { kind: "bulk", files: roles, missing: (["counts", "metadata"] as BulkRole[]).filter((r) => !have.has(r)) };
    }
    return { kind: "unknown", reason: "these tables are neither a counts matrix nor a sample sheet" };
  }
  return { kind: "unknown", reason: `no reader for ${files.map((f) => f.name).join(", ")}` };
}
