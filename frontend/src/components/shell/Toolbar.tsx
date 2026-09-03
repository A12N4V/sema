import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Waves, Activity, Anchor, MapPin, Repeat, CircleSlash, Layers, Download } from "lucide-react";
import { api } from "../../api/client";
import { applyOp, MONTAGES } from "../../lib/ops";
import { useStore } from "../../store/store";

/* ------------------------------------------------------------------ menu */
function Menu({ label, icon, children, width = 240 }: { label: string; icon: ReactNode; children: (close: () => void) => ReactNode; width?: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex h-full items-center gap-1.5 px-3 text-sm transition-colors ${open ? "bg-panel-2 text-fg" : "text-fg-dim hover:bg-panel-2 hover:text-fg"}`}
      >
        <span className="text-fg-faint">{icon}</span>
        {label}
        <ChevronDown size={12} className={`text-fg-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="pop absolute left-1.5 top-[calc(100%+4px)] z-40 p-3" style={{ width }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const field = "w-full rounded-xs border border-seam bg-bg px-2 py-1.5 text-sm text-fg outline-none transition-colors focus:border-accent";
const applyBtn = "mt-2.5 w-full rounded-xs border border-accent/40 bg-accent/12 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20";
const rowLabel = "mb-1.5 block text-xs text-fg-dim";

/* --------------------------------------------------------------- toolbar */
export function Toolbar() {
  const session = useStore((s) => s.session);
  const focusPanel = useStore((s) => s.focusPanel);
  const id = session?.session_id;
  if (!session || !id) return null;

  const chans = session.channel_names;

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-seam bg-bg">
      {/* filter */}
      <Menu label="Filter" icon={<Waves size={13} />}>
        {(close) => <FilterForm id={id} onDone={close} />}
      </Menu>

      {/* notch */}
      <Menu label="Notch" icon={<Activity size={13} />}>
        {(close) => <NotchForm id={id} onDone={close} />}
      </Menu>

      {/* reference */}
      <Menu label="Reference" icon={<Anchor size={13} />}>
        {(close) => <ReferenceForm id={id} onDone={close} />}
      </Menu>

      {/* montage */}
      <Menu label="Montage" icon={<MapPin size={13} />}>
        {(close) => <MontageForm id={id} onDone={close} />}
      </Menu>

      {/* resample */}
      <Menu label="Resample" icon={<Repeat size={13} />} width={200}>
        {(close) => <ResampleForm id={id} sfreq={session.sfreq} onDone={close} />}
      </Menu>

      {/* bad channels */}
      <Menu label="Bad channels" icon={<CircleSlash size={13} />} width={260}>
        {(close) => <BadForm id={id} chans={chans} bads={session.bads} onDone={close} />}
      </Menu>

      <div className="my-2 w-px bg-seam" />

      <button
        onClick={() => focusPanel("ica")}
        className="flex h-full items-center gap-1.5 px-3 text-sm text-fg-dim transition-colors hover:bg-panel-2 hover:text-fg"
      >
        <span className="text-fg-faint"><Layers size={13} /></span> ICA
      </button>

      <div className="flex-1" />

      <Menu label="Export" icon={<Download size={13} />} width={200}>
        {() => (
          <div className="flex flex-col gap-1.5 text-sm">
            <a className="text-accent hover:underline" href={api.exportPipelineUrl(id)} target="_blank" rel="noreferrer">pipeline.py</a>
            <a className="text-accent hover:underline" href={api.exportSummaryUrl(id)} target="_blank" rel="noreferrer">summary.csv</a>
            <a className="text-accent hover:underline" href={api.exportRawUrl(id)} target="_blank" rel="noreferrer">cleaned raw.fif</a>
          </div>
        )}
      </Menu>
    </div>
  );
}

/* ------------------------------------------------------------------ forms */
function FilterForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [lo, setLo] = useState("1");
  const [hi, setHi] = useState("40");
  const submit = async () => {
    const l = lo.trim() === "" || lo === "-" ? null : Number(lo);
    const h = hi.trim() === "" || hi === "-" ? null : Number(hi);
    await applyOp(() => api.bandpass(id, l, h), `Filtered ${l ?? "0"}–${h ?? "∞"} Hz`);
    onDone();
  };
  return (
    <div>
      <span className={rowLabel}>Band-pass · blank = open</span>
      <div className="flex gap-2">
        <input className={field} value={lo} onChange={(e) => setLo(e.target.value)} placeholder="low" />
        <input className={field} value={hi} onChange={(e) => setHi(e.target.value)} placeholder="high" />
      </div>
      <button className={applyBtn} onClick={submit}>Apply</button>
    </div>
  );
}

function NotchForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [v, setV] = useState("60");
  const submit = async () => {
    const freqs = v.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n));
    if (!freqs.length) return;
    await applyOp(() => api.notch(id, freqs), `Notched ${freqs.join(", ")} Hz`);
    onDone();
  };
  return (
    <div>
      <span className={rowLabel}>Notch (Hz, comma-separated)</span>
      <input className={field} value={v} onChange={(e) => setV(e.target.value)} placeholder="60 · 50, 100" />
      <button className={applyBtn} onClick={submit}>Apply</button>
    </div>
  );
}

function ReferenceForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [mode, setMode] = useState<"average" | "custom">("average");
  const [chs, setChs] = useState("");
  const submit = async () => {
    const ref = mode === "average" ? "average" : chs.split(",").map((s) => s.trim()).filter(Boolean);
    await applyOp(() => api.setReference(id, ref), "Re-referenced");
    onDone();
  };
  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-fg-dim">
        <input type="radio" checked={mode === "average"} onChange={() => setMode("average")} /> Average
      </label>
      <label className="mt-1 flex items-center gap-2 text-sm text-fg-dim">
        <input type="radio" checked={mode === "custom"} onChange={() => setMode("custom")} /> Channels
      </label>
      {mode === "custom" && (
        <input className={`${field} mt-1`} value={chs} onChange={(e) => setChs(e.target.value)} placeholder="M1, M2" />
      )}
      <button className={applyBtn} onClick={submit}>Apply</button>
    </div>
  );
}

function MontageForm({ id, onDone }: { id: string; onDone: () => void }) {
  const [m, setM] = useState<string>(MONTAGES[0]);
  const submit = async () => {
    await applyOp(() => api.setMontage(id, m), `Montage: ${m}`);
    onDone();
  };
  return (
    <div>
      <span className={rowLabel}>Standard montage</span>
      <select className={field} value={m} onChange={(e) => setM(e.target.value)}>
        {MONTAGES.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <button className={applyBtn} onClick={submit}>Set</button>
    </div>
  );
}

function ResampleForm({ id, sfreq, onDone }: { id: string; sfreq: number; onDone: () => void }) {
  const [v, setV] = useState(String(Math.round(sfreq)));
  const submit = async () => {
    const n = Number(v);
    if (!n || n <= 0) return;
    await applyOp(() => api.resample(id, n), `Resampled → ${n} Hz`);
    onDone();
  };
  return (
    <div>
      <span className={rowLabel}>Rate (Hz) · now {sfreq.toFixed(0)}</span>
      <input className={field} value={v} onChange={(e) => setV(e.target.value)} />
      <button className={applyBtn} onClick={submit}>Resample</button>
    </div>
  );
}

function BadForm({ id, chans, bads, onDone }: { id: string; chans: string[]; bads: string[]; onDone: () => void }) {
  const [set, setSet] = useState<Set<string>>(new Set(bads));
  const toggle = (ch: string) => setSet((prev) => {
    const next = new Set(prev);
    if (next.has(ch)) next.delete(ch);
    else next.add(ch);
    return next;
  });
  const submit = async () => {
    await applyOp(() => api.setBads(id, [...set]), `Bad: ${[...set].join(", ") || "(none)"}`);
    onDone();
  };
  return (
    <div>
      <span className={rowLabel}>Mark bad</span>
      <div className="grid max-h-48 grid-cols-3 gap-x-2 gap-y-0.5 overflow-y-auto">
        {chans.map((ch) => (
          <label key={ch} className="flex items-center gap-1 text-xs text-fg-dim">
            <input type="checkbox" checked={set.has(ch)} onChange={() => toggle(ch)} />
            {ch}
          </label>
        ))}
      </div>
      <button className={applyBtn} onClick={submit}>Apply</button>
    </div>
  );
}
