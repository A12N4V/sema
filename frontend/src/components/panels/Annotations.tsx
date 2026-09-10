import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Crosshair, Plus, Trash2, Wand2 } from "lucide-react";
import { clsx } from "clsx";
import { Panel } from "./Panel";
import { usePanelData } from "./usePanelData";
import { api, type AnnotationItem } from "../../api/client";
import { runOp } from "../../lib/ops";
import { useStore } from "../../store/store";
import { useSignatureKey } from "../../store/useSignatureKey";

/**
 * Annotations: events and bad segments, which the app previously could not
 * create, edit, or even see.
 *
 * Two things make this more than a list. Every row seeks the shared cursor, so
 * the trace view and this table are the same clock. And a description starting
 * `BAD` is called out, because that prefix is not cosmetic: MNE excludes those
 * spans from filtering, ICA and epoching, so it changes results.
 *
 * The whole set is sent on every edit. That keeps one ledger entry per change
 * and makes the step replayable as a value rather than as a diff.
 */
export function Annotations() {
  const session = useStore((s) => s.session);
  const t = useStore((s) => s.t);
  const seekTo = useStore((s) => s.seekTo);
  const sigKey = useSignatureKey();
  const id = session?.session_id;

  const [label, setLabel] = useState("stim");
  const [duration, setDuration] = useState("0");
  const [busy, setBusy] = useState(false);

  const { data, state, error } = usePanelData<{ annotations: AnnotationItem[]; labels: string[] }>(
    () => api.annotations(id!),
    [id, sigKey],
    { enabled: !!id, label: "Annotations" },
  );

  const items = data?.annotations ?? [];
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of items) out[a.description] = (out[a.description] ?? 0) + 1;
    return out;
  }, [items]);

  const write = async (next: AnnotationItem[] | { onset: number; duration: number; description: string }[],
                       message: string) => {
    setBusy(true);
    try {
      await runOp("set_annotations", {
        annotations: next.map((a) => ({
          onset: a.onset, duration: a.duration, description: a.description,
        })),
      }, message);
    } catch { /* runOp toasted */ } finally { setBusy(false); }
  };

  const add = () => {
    const d = Number(duration);
    if (!Number.isFinite(d) || d < 0) return toast.error("Duration must be zero or more");
    if (!label.trim()) return toast.error("An annotation needs a label");
    void write([...items, { onset: t, duration: d, description: label.trim() }],
      `Marked ${label.trim()} at ${t.toFixed(2)}s`);
  };

  const remove = (index: number) =>
    void write(items.filter((_, i) => i !== index), "Annotation removed");

  if (!session) return <Panel paneId="annotations" title="Annotations"><div /></Panel>;

  return (
    <Panel
      paneId="annotations"
      title={`Annotations · ${items.length}`}
      state={state}
      error={error}
      right={
        <button
          disabled={busy}
          onClick={() => void (async () => {
            setBusy(true);
            try { await runOp("annotate_muscle", { threshold: 5, min_length_good: 0.2 }, "Muscle artifact annotated"); }
            catch { /* toasted */ } finally { setBusy(false); }
          })()}
          title="z-scored high-frequency power marks EMG bursts as BAD_muscle"
          className="flex items-center gap-1 rounded-xs border border-seam px-1.5 py-0.5 text-2xs
                     text-fg-dim transition-colors hover:border-seam-bright hover:text-fg disabled:opacity-40"
        >
          <Wand2 size={10} /> Detect muscle
        </button>
      }
    >
      <div className="flex h-full flex-col">
        {/* add at the cursor: the one action that needs to be a single gesture */}
        <div className="flex shrink-0 flex-wrap items-end gap-1.5 border-b border-seam px-2 py-1.5">
          <label className="flex flex-col gap-0.5">
            <span className="text-2xs text-fg-faint">label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              list="annotation-labels"
              aria-label="Annotation label"
              className="mono w-[14ch] rounded-xs border border-seam bg-bg px-1.5 py-1 text-xs
                         outline-none focus:border-accent"
            />
            <datalist id="annotation-labels">
              {(data?.labels ?? []).map((l) => <option key={l} value={l} />)}
              <option value="BAD_segment" />
            </datalist>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-2xs text-fg-faint">duration</span>
            <span className="flex items-baseline gap-1 rounded-xs border border-seam bg-bg px-1.5 py-1
                             focus-within:border-accent">
              <input
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
                inputMode="decimal"
                aria-label="Annotation duration"
                className="mono w-[4ch] bg-transparent text-xs outline-none"
              />
              <span className="text-2xs text-fg-faint">s</span>
            </span>
          </label>
          <button
            onClick={add}
            disabled={busy}
            className="flex items-center gap-1 self-end rounded-xs border border-accent/50 bg-accent/10
                       px-2 py-1 text-xs text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
          >
            <Plus size={11} /> at {t.toFixed(2)}s
          </button>
          <span className="mono ml-auto self-end pb-1 text-2xs text-fg-faint max-[720px]:hidden">
            BAD_* is excluded from later maths
          </span>
        </div>

        {Object.keys(counts).length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-1 border-b border-seam px-2 py-1">
            {Object.entries(counts).map(([name, n]) => (
              <span key={name}
                    className={clsx("mono rounded-full border px-2 py-0.5 text-2xs",
                      name.toUpperCase().startsWith("BAD")
                        ? "border-alert/40 bg-alert/10 text-alert"
                        : "border-warn/40 bg-warn/10 text-warn")}>
                {name} {n}
              </span>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {items.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-xs text-fg-faint">
              Nothing marked. Move the cursor and add an event, or detect muscle artifact.
            </div>
          ) : (
            <table className="mono w-full border-collapse text-2xs tabular-nums">
              <tbody>
                {items.map((a) => (
                  <tr key={a.index} className="border-b border-seam/50 hover:bg-panel-2/60">
                    <td className="px-2 py-1">
                      <button
                        onClick={() => seekTo(a.onset)}
                        title="Move the cursor here"
                        className="flex items-center gap-1 text-fg-dim transition-colors hover:text-accent"
                      >
                        <Crosshair size={9} /> {a.onset.toFixed(2)}s
                      </button>
                    </td>
                    <td className="px-2 py-1 text-fg-faint">
                      {a.duration ? `${a.duration.toFixed(2)}s` : "point"}
                    </td>
                    <td className={clsx("px-2 py-1", a.bad ? "text-alert" : "text-fg")}>
                      {a.description}
                    </td>
                    <td className="px-1 py-1 text-right">
                      <button
                        aria-label={`Delete annotation at ${a.onset.toFixed(2)} seconds`}
                        onClick={() => remove(a.index)}
                        className="rounded-xs px-1 text-fg-faint transition-colors hover:text-alert"
                      >
                        <Trash2 size={10} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Panel>
  );
}
