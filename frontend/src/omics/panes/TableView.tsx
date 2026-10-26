import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { Empty } from "../ui/primitives";

function parseDelimited(text: string, sep: string, limit = 5000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; if (rows.length > limit) break; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const GENE_COLS = ["symbol", "gene", "gene_name", "leadingEdge_gene"];
const fmtCell = (c: string) => (/^-?\d+\.\d{5,}(e-?\d+)?$/.test(c) ? Number(c).toPrecision(4) : c);

/**
 * Any table a stage wrote. Sortable; and if it has a gene column, clicking a
 * row selects that gene everywhere (the spine), so a table is a way into the
 * figures rather than a dead end.
 */
export function TableView({ path }: { path: string }) {
  const runId = useStore((s) => s.runId);
  const gene = useStore((s) => s.gene);
  const [text, setText] = useState<string | null>(null);
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  useEffect(() => {
    if (!runId) return;
    setText(null); setSort(null);
    fetch(api.fileUrl(runId, path)).then((r) => r.text()).then((t) => setText(t.slice(0, 3_000_000)));
  }, [runId, path]);
  const ext = path.split(".").pop();
  const rows = useMemo(() => (text != null && (ext === "csv" || ext === "tsv") ? parseDelimited(text, ext === "csv" ? "," : "\t") : null), [text, ext]);
  const body = useMemo(() => {
    if (!rows) return [];
    const b = rows.slice(1).filter((r) => r.length > 1 || r[0]);
    if (sort) {
      const { col, dir } = sort;
      b.sort((a, c) => {
        const x = Number(a[col]), y = Number(c[col]);
        if (Number.isFinite(x) && Number.isFinite(y)) return (x - y) * dir;
        if (a[col] === "" || a[col] === "NA") return 1; if (c[col] === "" || c[col] === "NA") return -1;
        return a[col].localeCompare(c[col]) * dir;
      });
    }
    return b.slice(0, 1000);
  }, [rows, sort]);
  if (text == null) return <Empty>Loading…</Empty>;
  if (!rows) return <pre className="code h-full overflow-auto whitespace-pre-wrap p-3 text-fg-dim">{text}</pre>;
  const head = rows[0] ?? [];
  const gcol = head.findIndex((h) => GENE_COLS.includes(h));
  return (
    <div className="h-full overflow-auto">
      <table className="mono border-collapse text-2xs">
        <thead className="sticky top-0 z-[1] bg-panel">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap border-b border-r border-seam p-0 text-left font-medium text-fg-dim">
                <button className="flex w-full items-center gap-1 px-2 py-1 hover:text-fg"
                        onClick={() => setSort((s) => (s?.col === i ? (s.dir === 1 ? { col: i, dir: -1 } : null) : { col: i, dir: 1 }))}>
                  {h}{sort?.col === i && (sort.dir === 1 ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} onClick={() => gcol >= 0 && useStore.getState().set({ gene: r[gcol] })}
                className={clsx(gcol >= 0 && "cursor-pointer", r[gcol] === gene && gcol >= 0 ? "bg-accent/15" : "hover:bg-panel")}>
              {r.map((c, k) => <td key={k} className={clsx("whitespace-nowrap border-b border-r border-seam px-2 py-0.5", k === gcol ? "text-fg" : "text-fg-dim")}>{fmtCell(c)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 1001 && <p className="px-3 py-2 text-2xs text-fg-faint">First 1,000 rows (of {rows.length - 1 >= 5000 ? "5,000+" : rows.length - 1}). Download for the rest.</p>}
    </div>
  );
}
