import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown, ChevronUp, FileCode2, FileDown, FolderOpen, Loader2, Lock,
  Menu, Search, Settings2, Table2,
} from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";
import { api } from "../../api/client";
import { MONTAGES, runOp } from "../../lib/ops";
import { useStore } from "../../store/store";
import { useCapabilities } from "../../lib/useCapabilities";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { Mark } from "../ui/Brand";

/**
 * The verb axis. Office's model, for the reason Office has it: with two tab
 * axes you can put a parameter *on the surface* instead of behind a dialog.
 * The band-pass cut-offs are two boxes and a button, one action, not three
 * (open the palette, find the op, fill the form): and the figure behind them
 * stays visible while you change them, which is the whole point of adjusting a
 * filter. Operations without a hot parameter still deep-link into the palette's
 * generated form, so nothing is duplicated or reimplemented here.
 *
 * Tabs exist only where there is something real to put in them. Epochs earned
 * its tab when `make_epochs`, `average_epochs` and `compute_tfr` landed; before
 * that it would have been an 80%-grey ribbon, which is worse than no ribbon.
 */
type Tab = "home" | "clean" | "decompose" | "epochs" | "source" | "view" | "export";

const TABS: { id: Tab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "clean", label: "Clean" },
  { id: "decompose", label: "Decompose" },
  { id: "epochs", label: "Epochs" },
  { id: "source", label: "Source" },
  { id: "view", label: "View" },
  { id: "export", label: "Export" },
];

const OPEN_KEY = "sema:ribbonOpen";
const TAB_KEY = "sema:ribbonTab";

export function Ribbon({ onNewSession }: { onNewSession: () => void }) {
  const session = useStore((s) => s.session);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const isNarrow = useMediaQuery("(max-width: 720px)");
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const v = localStorage.getItem(TAB_KEY);
      return TABS.some((t) => t.id === v) ? (v as Tab) : "home";
    } catch {
      return "home";
    }
  });
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });

  const pick = (t: Tab) => {
    setTab(t);
    setOpen(true);
    try {
      localStorage.setItem(TAB_KEY, t);
      localStorage.setItem(OPEN_KEY, "1");
    } catch { /* ignore */ }
  };
  const collapse = () => {
    setOpen((o) => {
      try { localStorage.setItem(OPEN_KEY, o ? "0" : "1"); } catch { /* ignore */ }
      return !o;
    });
  };

  if (!session) return null;

  return (
    <div className="shrink-0 border-b border-seam bg-bg">
      {/* tab row, doubles as the title bar, so the ribbon costs one row, not two */}
      <div className="flex h-8 items-stretch gap-0.5 px-1.5">
        <span className="flex shrink-0 items-center pr-1.5 text-fg-faint" title="Sema">
          <Mark size={16} />
        </span>
        {/* Seven tabs plus the session controls do not fit a phone, and a row
            of half-legible words scrolling sideways is worse than one clear
            name: below the fold the tab axis collapses to a menu. */}
        {isNarrow ? (
          <TabMenu tab={tab} onPick={pick} />
        ) : (
          <div className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => (tab === t.id ? collapse() : pick(t.id))}
                aria-selected={tab === t.id && open}
                role="tab"
                className={clsx(
                  "shrink-0 rounded-t-sm px-2.5 text-sm transition-colors",
                  tab === t.id && open
                    ? "bg-panel font-medium text-fg"
                    : "text-fg-faint hover:bg-panel-2/60 hover:text-fg-dim",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => setPaletteOpen(true)}
          title="Every operation, searchable  (⌘K)"
          className="my-1.5 flex shrink-0 items-center gap-1.5 rounded-sm border border-seam px-2 text-xs
                     text-fg-faint transition-colors hover:border-seam-bright hover:text-fg-dim"
        >
          <Search size={11} />
          <span className="mono text-2xs max-[900px]:hidden">⌘K</span>
        </button>
        <SessionChip />
        <button onClick={onNewSession} title="Open another recording" aria-label="New session"
                className="flex shrink-0 items-center px-2 text-fg-faint transition-colors hover:text-fg">
          <FolderOpen size={14} />
        </button>
        <button onClick={() => setSettingsOpen(true)} aria-label="Settings"
                className="flex shrink-0 items-center px-2 text-fg-faint transition-colors hover:text-fg">
          <Settings2 size={14} />
        </button>
        <button onClick={collapse} aria-label={open ? "Collapse ribbon" : "Expand ribbon"}
                title={open ? "Collapse the ribbon" : "Expand the ribbon"}
                className="flex shrink-0 items-center px-1 text-fg-faint transition-colors hover:text-fg">
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {open && (
        <div className="flex items-stretch gap-0 overflow-x-auto bg-panel px-1.5 py-1.5" role="tabpanel">
          {tab === "home" && <HomeTab />}
          {tab === "clean" && <CleanTab />}
          {tab === "decompose" && <DecomposeTab />}
          {tab === "epochs" && <EpochsTab />}
          {tab === "source" && <SourceTab />}
          {tab === "view" && <ViewTab />}
          {tab === "export" && <ExportTab />}
        </div>
      )}
    </div>
  );
}

/** The tab axis on a phone: one button naming where you are, one list to move. */
function TabMenu({ tab, onPick }: { tab: Tab; onPick: (t: Tab) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div className="relative flex min-w-0 flex-1 items-center" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-sm font-medium text-fg
                   transition-colors hover:bg-panel-2"
      >
        <Menu size={13} className="text-fg-faint" />
        {TABS.find((t) => t.id === tab)?.label}
        <ChevronDown size={11} className="text-fg-faint" />
      </button>
      {open && (
        <div className="pop absolute left-1 top-[calc(100%+2px)] z-40 w-44 p-1" role="menu">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="menuitem"
              onClick={() => { onPick(t.id); setOpen(false); }}
              className={clsx(
                "block w-full rounded-xs px-2 py-1.5 text-left text-sm transition-colors",
                t.id === tab ? "bg-accent/12 text-accent" : "text-fg-dim hover:bg-panel-2 hover:text-fg",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- ribbon parts */

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col justify-between gap-1 border-r border-seam px-2.5 last:border-r-0">
      <div className="flex items-end gap-1.5">{children}</div>
      <div className="text-center text-2xs uppercase tracking-wide text-fg-faint">{label}</div>
    </div>
  );
}

/** A labelled numeric box. Tabular figures, so a column of them lines up. */
function Field({
  label, value, onChange, onEnter, width = "5ch", suffix, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  width?: string;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-2xs text-fg-faint">{label}</span>
      <span className="flex items-baseline gap-1 rounded-xs border border-seam bg-bg px-1.5 py-1
                       focus-within:border-accent">
        <input
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
          inputMode="decimal"
          style={{ width }}
          className="mono bg-transparent text-xs outline-none"
        />
        {suffix && <span className="text-2xs text-fg-faint">{suffix}</span>}
      </span>
    </label>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-2xs text-fg-faint">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mono rounded-xs border border-seam bg-bg px-1.5 py-1 text-xs outline-none focus:border-accent"
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function Btn({ children, onClick, primary, disabled, title, busy }: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
  busy?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={clsx(
        "flex items-center gap-1 self-end rounded-xs border px-2 py-1 text-xs transition-colors",
        disabled
          ? "cursor-not-allowed border-seam text-fg-faint opacity-50"
          : primary
            ? "border-accent/50 bg-accent/10 text-accent hover:bg-accent/20"
            : "border-seam text-fg-dim hover:border-seam-bright hover:bg-panel-2 hover:text-fg",
      )}
    >
      {busy && <Loader2 size={10} className="animate-spin" />}
      {disabled && !busy && <Lock size={9} />}
      {children}
    </button>
  );
}

/** Deep-link into the palette's generated form: for ops with no hot parameter. */
function OpBtn({ op, label, requires }: { op: string; label: string; requires?: string }) {
  const openOp = useStore((s) => s.openOp);
  const caps = useCapabilities();
  const locked = !!requires && !caps.has(requires);
  return (
    <Btn onClick={() => openOp(op)} disabled={locked} title={locked ? `needs: ${requires}` : undefined}>
      {label}
    </Btn>
  );
}

/** Wraps a ribbon action so the button shows its own spinner. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch { /* runOp already toasted */ } finally { setBusy(false); }
  };
  return { busy, run };
}

/* -------------------------------------------------------------------- tabs */

function HomeTab() {
  const montageName = useStore((s) => s.montageName);
  const prepareFigures = useStore((s) => s.prepareFigures);
  const prepState = useStore((s) => s.prepState);
  const filmstrip = useStore((s) => s.filmstrip);
  const [montage, setMontage] = useState(montageName ?? "standard_1020");
  const { busy, run } = useAction();

  return (
    <>
      <Group label="Montage">
        <Select label="layout" value={montage} onChange={setMontage} options={[...MONTAGES]} />
        <Btn primary busy={busy} onClick={() => run(() =>
          runOp("set_montage", { montage_name: montage }, `Montage · ${montage}`))}>
          Set
        </Btn>
      </Group>

      <Group label="Channels">
        <OpBtn op="set_bads" label="Bad channels…" />
        <OpBtn op="interpolate_bads" label="Interpolate" requires="has_bads" />
      </Group>

      <Group label="Sampling">
        <ResampleControl />
      </Group>

      <Group label="Figures">
        <Btn onClick={() => void prepareFigures()} busy={prepState === "running"}
             title="Re-render every figure for the current signal">
          {prepState === "running" ? "Preparing…" : "Prepare all"}
        </Btn>
        <span className="mono self-end pb-1 text-2xs text-fg-faint">
          {filmstrip ? `${filmstrip.times.length} frames` : "not prepared"}
        </span>
      </Group>
    </>
  );
}

function ResampleControl() {
  const session = useStore((s) => s.session)!;
  const [sfreq, setSfreq] = useState(String(Math.round(session.sfreq)));
  const { busy, run } = useAction();
  useEffect(() => setSfreq(String(Math.round(session.sfreq))), [session.sfreq]);
  const apply = () => {
    const v = Number(sfreq);
    if (!Number.isFinite(v) || v <= 0) return toast.error("Sample rate must be a positive number");
    void run(() => runOp("resample", { sfreq: v }, `Resampled to ${v} Hz`));
  };
  return (
    <>
      <Field label="rate" value={sfreq} onChange={setSfreq} onEnter={apply} suffix="Hz" />
      <Btn busy={busy} onClick={apply}>Resample</Btn>
    </>
  );
}

function CleanTab() {
  const session = useStore((s) => s.session)!;
  const [lo, setLo] = useState(session.highpass ? String(session.highpass) : "1");
  const [hi, setHi] = useState(session.lowpass ? String(session.lowpass) : "40");
  const [notch, setNotch] = useState("60");
  const [ref, setRef] = useState("average");
  const filt = useAction();
  const notchAct = useAction();
  const refAct = useAction();

  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  /** "1-40 Hz", "above 1 Hz", "below 40 Hz": never a blank where a number goes. */
  const filterLabel = (l: number | null, h: number | null) =>
    l != null && h != null ? `Filtered ${l}\u2013${h} Hz`
      : l != null ? `High-passed above ${l} Hz`
        : h != null ? `Low-passed below ${h} Hz`
          : "Filter cleared";
  const applyFilter = () => {
    const l = num(lo), h = num(hi);
    if ((l !== null && !Number.isFinite(l)) || (h !== null && !Number.isFinite(h))) {
      return toast.error("Cut-offs must be numbers (or blank for none)");
    }
    if (l !== null && h !== null && l >= h) return toast.error("High-pass must be below low-pass");
    void filt.run(() => runOp("filter", { l_freq: l, h_freq: h },
      filterLabel(l, h)));
  };
  const applyNotch = () => {
    const f = Number(notch);
    if (!Number.isFinite(f) || f <= 0) return toast.error("Notch frequency must be positive");
    void notchAct.run(() => runOp("notch", { freqs: [f] }, `Notched ${f} Hz`));
  };

  return (
    <>
      {/* the hottest operation in the app: two boxes and a button, with the
          recording still on screen behind them */}
      <Group label="Band-pass">
        <Field label="high-pass" value={lo} onChange={setLo} onEnter={applyFilter} suffix="Hz" placeholder="none" />
        <Field label="low-pass" value={hi} onChange={setHi} onEnter={applyFilter} suffix="Hz" placeholder="none" />
        <Btn primary busy={filt.busy} onClick={applyFilter}>Apply</Btn>
      </Group>

      <Group label="Notch">
        <Field label="line" value={notch} onChange={setNotch} onEnter={applyNotch} suffix="Hz" />
        <Btn busy={notchAct.busy} onClick={applyNotch}>Apply</Btn>
      </Group>

      <Group label="Reference">
        <Select label="mode" value={ref} onChange={setRef} options={["average", "REST", "channels"]} />
        <Btn busy={refAct.busy}
             onClick={() => {
               if (ref === "channels") return useStore.getState().openOp("set_reference");
               void refAct.run(() => runOp("set_reference", { mode: ref }, `Re-referenced · ${ref}`));
             }}>
          Apply
        </Btn>
      </Group>

      <Group label="Artifacts">
        <OpBtn op="annotate_amplitude" label="By amplitude…" />
        <OpBtn op="annotate_muscle" label="Detect muscle" />
      </Group>

      {/* the automatic pass EEGLAB users know as clean_rawdata */}
      <Group label="Automatic">
        <OpBtn op="detect_bad_channels" label="Detect bad channels" requires="montage" />
        <OpBtn op="interpolate_bads" label="Interpolate" requires="has_bads" />
      </Group>
    </>
  );
}

function DecomposeTab() {
  const hasIca = useStore((s) => s.hasIca);
  const caps = useCapabilities();
  const [n, setN] = useState("20");
  const { busy, run } = useAction();
  const ready = caps.has("montage") && caps.has("filtered_1hz");

  return (
    <>
      <Group label="ICA">
        <Field label="components" value={n} onChange={setN} width="4ch" />
        <Btn primary busy={busy} disabled={!ready}
             title={ready ? undefined : "needs a montage and a ≥1 Hz high-pass"}
             onClick={() => {
               const v = Number(n);
               if (!Number.isFinite(v) || v <= 0) return toast.error("Components must be a positive number");
               void run(() => runOp("fit_ica", { n_components: v }, `Fitted ICA · ${v} components`));
             }}>
          Fit
        </Btn>
      </Group>
      <Group label="Prerequisites">
        <Gate ok={caps.has("montage")} label="montage" />
        <Gate ok={caps.has("filtered_1hz")} label="≥1 Hz high-pass" />
        <Gate ok={hasIca} label="fitted" />
      </Group>
      <Group label="Classify">
        <OpBtn op="label_ica" label="ICLabel" requires="ica" />
        <OpBtn op="exclude_ica_by_label" label="Mark artifacts…" requires="ica_labels" />
      </Group>
      <Group label="Review">
        <span className="self-end pb-1 text-2xs text-fg-faint">
          {hasIca ? "mark components on the ICA tab, then apply there" : "fit first"}
        </span>
      </Group>
    </>
  );
}

function Gate({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={clsx("self-end rounded-full border px-2 py-0.5 text-2xs",
      ok ? "border-good/40 bg-good/10 text-good" : "border-seam text-fg-faint")}>
      {ok ? "✓" : "·"} {label}
    </span>
  );
}

/**
 * The epoched chain, in the order it runs. Each group is disabled until the one
 * before it has produced its container, so the tab reads as a sequence rather
 * than as a menu of three unrelated things.
 */
function EpochsTab() {
  const caps = useCapabilities();
  const [tmin, setTmin] = useState("-0.2");
  const [tmax, setTmax] = useState("0.8");
  const [reject, setReject] = useState("150");
  const [fmin, setFmin] = useState("4");
  const [fmax, setFmax] = useState("40");
  const cut = useAction();
  const avg = useAction();
  const tf = useAction();
  const hasEpochs = caps.has("epochs");

  return (
    <>
      <Group label="Cut trials">
        <Field label="tmin" value={tmin} onChange={setTmin} width="4ch" suffix="s" />
        <Field label="tmax" value={tmax} onChange={setTmax} width="4ch" suffix="s" />
        <Field label="reject" value={reject} onChange={setReject} width="4ch" suffix="µV"
               placeholder="none" />
        <Btn primary busy={cut.busy}
             onClick={() => {
               const a = Number(tmin), b = Number(tmax);
               if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b) {
                 return toast.error("tmin must be below tmax");
               }
               const r = reject.trim() === "" ? null : Number(reject);
               if (r !== null && (!Number.isFinite(r) || r <= 0)) {
                 return toast.error("Rejection must be a positive number, or blank");
               }
               void cut.run(() => runOp("make_epochs",
                 { tmin: a, tmax: b, description: null, baseline: true, reject_uv: r },
                 "Epochs created"));
             }}>
          Create epochs
        </Btn>
      </Group>

      <Group label="Average">
        <Btn busy={avg.busy} disabled={!hasEpochs}
             title={hasEpochs ? undefined : "needs epochs"}
             onClick={() => void avg.run(() =>
               runOp("average_epochs", { condition: null }, "Averaged to evoked"))}>
          To evoked
        </Btn>
      </Group>

      <Group label="Time-frequency">
        <Field label="from" value={fmin} onChange={setFmin} width="4ch" suffix="Hz" />
        <Field label="to" value={fmax} onChange={setFmax} width="4ch" suffix="Hz" />
        <Btn busy={tf.busy} disabled={!hasEpochs}
             title={hasEpochs ? undefined : "needs epochs"}
             onClick={() => void tf.run(() => runOp("compute_tfr",
               { fmin: Number(fmin), fmax: Number(fmax), n_freqs: 24, decim: 3 },
               "Time-frequency computed"))}>
          Morlet
        </Btn>
      </Group>

      <Group label="Chain">
        <Gate ok={caps.has("annotations")} label="events" />
        <Gate ok={hasEpochs} label="epochs" />
        <Gate ok={caps.has("evoked")} label="evoked" />
        <Gate ok={caps.has("tfr")} label="tfr" />
      </Group>
    </>
  );
}

function SourceTab() {
  const caps = useCapabilities();
  const t = useStore((s) => s.t);
  const [method, setMethod] = useState("dSPM");
  const { busy, run } = useAction();
  const ready = caps.has("montage");

  return (
    <>
      <Group label="Inverse">
        <Select label="method" value={method} onChange={setMethod}
                options={["dSPM", "MNE", "sLORETA", "eLORETA"]} />
        <Btn primary busy={busy} disabled={!ready} title={ready ? undefined : "needs a montage"}
             onClick={() => void run(() =>
               runOp("compute_source", { method, center_t: Math.round(t * 10) / 10 },
                 `Source estimate · ${method}`))}>
          Compute at cursor
        </Btn>
      </Group>
      <Group label="Window">
        <span className="mono self-end pb-1 text-2xs text-fg-faint">
          ±4 s around t = {t.toFixed(2)} s
        </span>
      </Group>
      <Group label="Template">
        <Gate ok={caps.has("montage")} label="montage" />
        <span className="self-end pb-1 text-2xs text-fg-faint max-[900px]:hidden">
          fsaverage · first run downloads ~770 MB
        </span>
      </Group>
    </>
  );
}

function ViewTab() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const windowDuration = useStore((s) => s.windowDuration);
  const setWindow = useStore((s) => s.setWindow);
  const windowStart = useStore((s) => s.windowStart);
  const maximized = useStore((s) => s.maximized);
  const setMaximized = useStore((s) => s.setMaximized);

  return (
    <>
      <Group label="Window">
        {[2, 5, 10, 20, 30, 60].map((d) => (
          <button
            key={d}
            onClick={() => setWindow(windowStart, d)}
            className={clsx("mono self-end rounded-xs border px-2 py-1 text-xs transition-colors",
              Math.abs(windowDuration - d) < 0.01
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-seam text-fg-dim hover:bg-panel-2 hover:text-fg")}
          >
            {d}s
          </button>
        ))}
      </Group>
      <Group label="Panes">
        <Btn onClick={() => setMaximized(maximized ? null : "waveform")}>
          {maximized ? "Restore" : "Maximize waveform"}
        </Btn>
      </Group>
      <Group label="Theme">
        {(["system", "light", "dark"] as const).map((tv) => (
          <button
            key={tv}
            onClick={() => setTheme(tv)}
            className={clsx("self-end rounded-xs border px-2 py-1 text-xs capitalize transition-colors",
              theme === tv
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-seam text-fg-dim hover:bg-panel-2 hover:text-fg")}
          >
            {tv}
          </button>
        ))}
      </Group>
    </>
  );
}

function ExportTab() {
  const session = useStore((s) => s.session)!;
  const id = session.session_id;
  const history = useStore((s) => s.history);
  const link = (href: string, label: string, Icon: typeof FileCode2, hint: string) => (
    <a
      href={href}
      download
      title={hint}
      className="flex items-center gap-1.5 self-end rounded-xs border border-seam px-2 py-1 text-xs
                 text-fg-dim transition-colors hover:border-seam-bright hover:bg-panel-2 hover:text-fg"
    >
      <Icon size={11} /> {label}
    </a>
  );
  return (
    <>
      <Group label="Reproduce">
        {link(api.exportPipelineUrl(id), "pipeline.py", FileCode2,
          `A runnable MNE script for all ${history.length} steps`)}
      </Group>
      <Group label="Data">
        {link(api.exportRawUrl(id), "raw.fif", FileDown, "The cleaned recording")}
        {link(api.exportSummaryUrl(id), "summary.csv", Table2, "Per-channel summary")}
      </Group>
    </>
  );
}

/* --------------------------------------------------------------- session chip */

const CAP_LABEL: Record<string, string> = {
  montage: "montage", filtered_1hz: "≥1 Hz", has_bads: "bads",
  ica: "ICA", epochs: "epochs", source: "source", fsaverage: "fsaverage",
};

function SessionChip() {
  const session = useStore((s) => s.session)!;
  const caps = useStore((s) => s.capabilities);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div className="relative flex shrink-0 items-center" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-[24ch] items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-fg-dim
                   transition-colors hover:bg-panel-2 hover:text-fg max-[720px]:max-w-[11ch]"
      >
        <span className="mono truncate max-[720px]:hidden">{session.filename}</span>
        <span className="mono shrink-0 text-2xs text-fg-faint max-[900px]:hidden">{session.n_channels}ch</span>
        <span className="mono shrink-0 text-2xs min-[721px]:hidden">{session.n_channels}ch</span>
        <ChevronDown size={11} className="shrink-0 text-fg-faint" />
      </button>
      {open && (
        <div className="pop absolute right-0 top-[calc(100%+4px)] z-40 w-60 max-w-[88vw] p-2.5">
          <div className="mono mb-2 truncate text-xs text-fg">{session.filename}</div>
          <div className="flex flex-col gap-1 text-2xs">
            <Row k="channels" v={`${session.n_channels}`} />
            <Row k="sample rate" v={`${session.sfreq.toFixed(0)} Hz`} />
            <Row k="duration" v={`${(session.duration_seconds / 60).toFixed(1)} min`} />
            <Row k="highpass" v={session.highpass != null ? `${session.highpass} Hz` : "none"} />
            <Row k="lowpass" v={session.lowpass != null ? `${session.lowpass} Hz` : "none"} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1 border-t border-seam pt-2">
            {caps.map((c) => (
              <span key={c} title={`capability: ${c}`}
                    className="rounded-full border border-good/40 bg-good/10 px-2 py-0.5 text-2xs text-good">
                {CAP_LABEL[c] ?? c} ✓
              </span>
            ))}
            {session.bads.length > 0 && (
              <span title={session.bads.join(", ")}
                    className="rounded-full border border-alert/40 bg-alert/10 px-2 py-0.5 text-2xs text-alert">
                {session.bads.length} bad
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex items-baseline justify-between gap-2">
    <span className="text-fg-faint">{k}</span>
    <span className="mono text-fg-dim">{v}</span>
  </div>
);
