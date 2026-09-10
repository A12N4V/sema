import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Check, Search, Trash2, Wand2, X } from "lucide-react";
import { clsx } from "clsx";
import { Panel } from "./Panel";
import { usePanelData } from "./usePanelData";
import { api, type ChannelRow } from "../../api/client";
import { runOp } from "../../lib/ops";
import { useStore } from "../../store/store";
import { useSignatureKey } from "../../store/useSignatureKey";

/**
 * The channel table. EEGLAB has had one for twenty years and this project's
 * only channel management was typing names into a text box.
 *
 * Everything here is a real MNE call through the operation registry, so a
 * rename, a retype and a drop all land in the ledger and in pipeline.py. The
 * numeric columns exist so the table can be *sorted into* a decision: sort by
 * peak-to-peak and the dead and the noisy channels sit at the two ends.
 */
type SortKey = "index" | "name" | "type" | "peak_to_peak" | "std";

const TYPES = ["eeg", "eog", "ecg", "emg", "misc", "stim"];

export function ChannelsTable() {
  const session = useStore((s) => s.session);
  const selected = useStore((s) => s.selectedChannels);
  const setSelectedChannels = useStore((s) => s.setSelectedChannels);
  const focusChannel = useStore((s) => s.focusChannel);
  const setFocusChannel = useStore((s) => s.setFocusChannel);
  const sigKey = useSignatureKey();
  const id = session?.session_id;

  const [sort, setSort] = useState<SortKey>("index");
  const [desc, setDesc] = useState(false);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, state, error } = usePanelData<{ channels: ChannelRow[] }>(
    () => api.channels(id!),
    [id, sigKey],
    { enabled: !!id, label: "Channels" },
  );

  const rows = useMemo(() => {
    const list = (data?.channels ?? []).filter(
      (r) => !query || r.name.toLowerCase().includes(query.toLowerCase()) || r.type.includes(query.toLowerCase()));
    const dir = desc ? -1 : 1;
    return [...list].sort((a, b) => {
      const x = a[sort];
      const y = b[sort];
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  }, [data, sort, desc, query]);

  const bads = new Set(session?.bads ?? []);
  const shown = new Set(selected);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch { /* runOp toasted */ } finally { setBusy(false); }
  };

  const toggleBad = (name: string) => {
    const next = bads.has(name)
      ? (session?.bads ?? []).filter((b) => b !== name)
      : [...(session?.bads ?? []), name];
    void act(() => runOp("set_bads", { bads: next },
      next.length ? `${next.length} channel${next.length === 1 ? "" : "s"} marked bad` : "No bad channels"));
  };

  const commitRename = (from: string) => {
    const to = draft.trim();
    setRenaming(null);
    if (!to || to === from) return;
    if (data?.channels.some((c) => c.name === to)) return toast.error(`${to} already exists`);
    void act(() => runOp("rename_channels", { mapping: { [from]: to } }, `Renamed ${from} to ${to}`));
  };

  const head = (key: SortKey, label: string, align = "left") => (
    <th
      className={clsx("sticky top-0 z-10 select-none border-b border-seam bg-panel px-2 py-1",
        "cursor-pointer font-medium text-fg-faint hover:text-fg",
        align === "right" ? "text-right" : "text-left")}
      onClick={() => { setDesc(sort === key ? !desc : false); setSort(key); }}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sort === key && (desc ? <ArrowDown size={9} /> : <ArrowUp size={9} />)}
      </span>
    </th>
  );

  if (!session) return <Panel paneId="channels" title="Channels"><div /></Panel>;

  return (
    <Panel
      paneId="channels"
      title={`Channels · ${session.n_channels} · ${bads.size} bad`}
      state={state}
      error={error}
      right={
        <div className="flex items-center gap-1.5">
          <label className="flex items-center gap-1 rounded-xs border border-seam px-1.5 py-0.5
                            focus-within:border-accent">
            <Search size={10} className="text-fg-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="filter"
              aria-label="Filter channels"
              className="mono w-[9ch] bg-transparent text-2xs outline-none"
            />
          </label>
          <button
            disabled={busy}
            onClick={() => void act(() => runOp("detect_bad_channels", { threshold: 1.5, n_neighbors: 20 },
              "Bad channels detected"))}
            title="Local Outlier Factor over the channel covariance"
            className="flex items-center gap-1 rounded-xs border border-seam px-1.5 py-0.5 text-2xs
                       text-fg-dim transition-colors hover:border-seam-bright hover:text-fg disabled:opacity-40"
          >
            <Wand2 size={10} /> Detect bad
          </button>
        </div>
      }
    >
      <div className="h-full overflow-auto">
        <table className="mono w-full border-collapse text-2xs tabular-nums">
          <thead>
            <tr>
              {head("index", "#")}
              {head("name", "channel")}
              {head("type", "type")}
              {head("peak_to_peak", "p-p µV", "right")}
              {head("std", "sd µV", "right")}
              <th className="sticky top-0 z-10 border-b border-seam bg-panel px-2 py-1 text-right font-medium text-fg-faint">
                bad
              </th>
              <th className="sticky top-0 z-10 border-b border-seam bg-panel px-2 py-1 text-right font-medium text-fg-faint">
                shown
              </th>
              <th className="sticky top-0 z-10 border-b border-seam bg-panel px-1 py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.name}
                onClick={() => setFocusChannel(focusChannel === r.name ? null : r.name)}
                className={clsx("border-b border-seam/50 transition-colors",
                  focusChannel === r.name ? "bg-accent/10" : "hover:bg-panel-2/60",
                  r.bad && "text-alert")}
              >
                <td className="px-2 py-0.5 text-fg-faint">{r.index}</td>
                <td className="px-2 py-0.5">
                  {renaming === r.name ? (
                    <input
                      autoFocus
                      value={draft}
                      aria-label={`Rename ${r.name}`}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(r.name)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(r.name);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      className="w-[12ch] rounded-xs border border-accent bg-bg px-1 outline-none"
                    />
                  ) : (
                    <button
                      className={clsx("text-left hover:underline", r.bad && "line-through")}
                      title="Click to rename"
                      onClick={(e) => { e.stopPropagation(); setRenaming(r.name); setDraft(r.name); }}
                    >
                      {r.name}
                    </button>
                  )}
                  {!r.has_position && (
                    <span className="ml-1 text-fg-faint" title="No position in the montage">◦</span>
                  )}
                </td>
                <td className="px-2 py-0.5">
                  <select
                    value={r.type}
                    aria-label={`Type of ${r.name}`}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => void act(() => runOp("set_channel_types",
                      { mapping: { [r.name]: e.target.value } }, `${r.name} is now ${e.target.value}`))}
                    className="cursor-pointer rounded-xs border border-transparent bg-transparent text-2xs
                               text-fg-dim outline-none hover:border-seam focus:border-accent"
                  >
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    {!TYPES.includes(r.type) && <option value={r.type}>{r.type}</option>}
                  </select>
                </td>
                <td className={clsx("px-2 py-0.5 text-right", r.flat && "text-warn")}
                    title={r.flat ? "Flat: no variance at all" : undefined}>
                  {r.peak_to_peak.toFixed(1)}
                </td>
                <td className="px-2 py-0.5 text-right">{r.std.toFixed(1)}</td>
                <td className="px-2 py-0.5 text-right">
                  <button
                    aria-label={r.bad ? `Unmark ${r.name}` : `Mark ${r.name} bad`}
                    onClick={(e) => { e.stopPropagation(); toggleBad(r.name); }}
                    className={clsx("rounded-xs border px-1", r.bad
                      ? "border-alert/50 bg-alert/15 text-alert"
                      : "border-seam text-fg-faint hover:text-fg")}
                  >
                    {r.bad ? <Check size={9} /> : <X size={9} className="opacity-40" />}
                  </button>
                </td>
                <td className="px-2 py-0.5 text-right">
                  <input
                    type="checkbox"
                    aria-label={`Show ${r.name} in the waveform`}
                    checked={shown.has(r.name)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => setSelectedChannels(
                      shown.has(r.name)
                        ? selected.filter((c) => c !== r.name)
                        : [...selected, r.name])}
                  />
                </td>
                <td className="px-1 py-0.5 text-right">
                  <button
                    aria-label={`Drop ${r.name}`}
                    title="Remove this channel from the recording"
                    onClick={(e) => {
                      e.stopPropagation();
                      void act(() => runOp("drop_channels", { channels: [r.name] }, `Dropped ${r.name}`));
                    }}
                    className="rounded-xs px-1 text-fg-faint transition-colors hover:text-alert"
                  >
                    <Trash2 size={10} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-6 text-center text-xs text-fg-faint">No channel matches that filter.</div>
        )}
      </div>
    </Panel>
  );
}
