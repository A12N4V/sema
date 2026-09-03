import { FolderOpen, Settings2 } from "lucide-react";
import { useStore } from "../../store/store";
import { fmtTime } from "../../lib/plot/scales";

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "alert" | "good" | "accent" }) {
  const color =
    tone === "alert" ? "text-alert" : tone === "good" ? "text-good" : tone === "accent" ? "text-accent" : "text-fg-dim";
  return (
    <div className="flex shrink-0 items-baseline gap-1.5 px-3" title={label}>
      <span className="text-2xs text-fg-faint">{label}</span>
      <span className={`mono text-sm ${color}`}>{value}</span>
    </div>
  );
}

export function StatusTicker({ onNewSession }: { onNewSession: () => void }) {
  const s = useStore((st) => st.session);
  const t = useStore((st) => st.t);
  const montageName = useStore((st) => st.montageName);
  const hasIca = useStore((st) => st.hasIca);
  const openSettings = useStore((st) => st.setSettingsOpen);
  if (!s) return null;

  const filt =
    s.highpass || s.lowpass
      ? `${s.highpass ? s.highpass.toFixed(s.highpass < 1 ? 2 : 0) : "0"}–${s.lowpass ? s.lowpass.toFixed(0) : "∞"} Hz`
      : "none";

  return (
    <div className="flex h-9 shrink-0 items-center divide-x divide-seam border-b border-seam bg-bg text-fg-dim">
      <div className="flex min-w-0 shrink items-center gap-2 px-3">
        <span className="shrink-0 text-sm font-semibold tracking-tight text-fg">EEGvis</span>
        <span className="mono truncate text-sm text-fg-dim">{s.filename}</span>
      </div>
      <Stat label="ch" value={String(s.n_channels)} />
      <Stat label="sfreq" value={`${s.sfreq.toFixed(0)}`} />
      <Stat label="dur" value={fmtTime(s.duration_seconds)} />
      <Stat label="filter" value={filt} tone={filt === "none" ? "default" : "accent"} />
      <Stat label="montage" value={montageName ?? (s.has_montage ? "file" : "—")} tone={s.has_montage ? "good" : "alert"} />
      {s.bads.length > 0 && <Stat label="bad" value={s.bads.join(", ")} tone="alert" />}
      {hasIca && <Stat label="ICA" value="fitted" tone="accent" />}
      <div className="flex-1" />
      <Stat label="t" value={fmtTime(t)} tone="accent" />
      <button
        onClick={onNewSession}
        className="flex h-full items-center gap-1.5 border-l border-seam px-3 text-sm text-fg-dim transition-colors hover:bg-panel-2 hover:text-fg"
      >
        <FolderOpen size={14} /> New session
      </button>
      <button
        onClick={() => openSettings(true)}
        aria-label="Settings"
        className="flex h-full items-center px-3 text-fg-dim transition-colors hover:bg-panel-2 hover:text-fg"
      >
        <Settings2 size={15} />
      </button>
    </div>
  );
}
