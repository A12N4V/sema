import { toast } from "sonner";
import { Undo2, GitBranch } from "lucide-react";
import { api } from "../../api/client";
import { runOp } from "../../lib/ops";
import { useStore } from "../../store/store";
import { GroupLabel, KV } from "../ui/primitives";
import { RenderedImage } from "../cards/RenderedImage";
import { useSignatureKey } from "../../store/useSignatureKey";

export function Inspector() {
  const session = useStore((s) => s.session);
  const focusChannel = useStore((s) => s.focusChannel);
  const setFocusChannel = useStore((s) => s.setFocusChannel);
  const component = useStore((s) => s.component);
  const selectedStep = useStore((s) => s.selectedStep);
  const setSelectedStep = useStore((s) => s.setSelectedStep);
  const history = useStore((s) => s.history);
  const patchSession = useStore((s) => s.patchSession);
  const refreshHistory = useStore((s) => s.refreshHistory);
  const refreshGraph = useStore((s) => s.refreshGraph);
  const loadLayout = useStore((s) => s.loadLayout);
  const sigKey = useSignatureKey();
  const id = session?.session_id;

  const revert = async (seq: number) => {
    if (!id) return;
    try {
      patchSession(await api.revert(id, seq));
      await Promise.all([refreshHistory(), refreshGraph(), loadLayout()]);
      setSelectedStep(null);
      toast.success(seq === 0 ? "Reverted to pristine" : `Checked out step ${seq}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  let body: React.ReactNode;
  let heading = "Inspector";

  if (focusChannel && session) {
    const isBad = session.bads.includes(focusChannel);
    heading = `Channel · ${focusChannel}`;
    body = (
      <div className="flex flex-col gap-2">
        <div className="h-28 overflow-hidden rounded-xs border border-seam">
          {session.has_montage ? (
            <RenderedImage
              spec={{ view: "sensors", width: 260, height: 240 }}
              deps={[sigKey]}
              alt="sensors"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-2xs text-fg-faint">no montage</div>
          )}
        </div>
        <KV k="type" v={session.channel_types[session.channel_names.indexOf(focusChannel)] ?? "eeg"} />
        <KV k="status" v={isBad ? "bad" : "good"} tone={isBad ? "alert" : "good"} />
        <div className="flex flex-wrap gap-1.5 pt-1">
          <button
            className="rounded-xs border border-seam px-2 py-1 text-2xs text-fg-dim hover:text-fg"
            onClick={() => {
              const next = isBad
                ? session.bads.filter((b) => b !== focusChannel)
                : [...session.bads, focusChannel];
              runOp("set_bads", { bads: next }, isBad ? "Unmarked" : `Marked ${focusChannel} bad`);
            }}
          >
            {isBad ? "unmark bad" : "mark bad"}
          </button>
          {isBad && session.has_montage && (
            <button
              className="rounded-xs border border-accent/40 bg-accent/10 px-2 py-1 text-2xs text-accent hover:bg-accent/20"
              onClick={() => runOp("interpolate_bads", { reset_bads: true }, "Interpolated")}
            >
              interpolate
            </button>
          )}
        </div>
      </div>
    );
  } else if (component != null && session) {
    heading = `Component · IC ${component}`;
    body = (
      <div className="flex flex-col gap-2">
        <div className="h-32 overflow-hidden rounded-xs border border-seam">
          <RenderedImage
            spec={{ view: "ica_component", component, width: 240, height: 240 }}
            deps={[sigKey, component]}
            alt={`IC ${component}`}
          />
        </div>
        <p className="text-2xs text-fg-faint">Double-click the component card to toggle removal.</p>
      </div>
    );
  } else if (selectedStep != null) {
    const e = history.find((h) => h.seq === selectedStep);
    heading = `Step · #${selectedStep}`;
    body = e ? (
      <div className="flex flex-col gap-2">
        <pre className="mono overflow-x-auto whitespace-pre-wrap rounded-xs border border-seam bg-bg p-2 text-2xs text-fg-dim">
          {e.rendered}
        </pre>
        <KV k="op" v={e.op} />
        {"n_bads" in e.info_after && <KV k="bad after" v={String(e.info_after.n_bads)} />}
        {"sfreq" in e.info_after && <KV k="sfreq" v={`${String(e.info_after.sfreq)} Hz`} />}
        <div className="flex gap-1.5 pt-1">
          <button
            onClick={() => revert(selectedStep)}
            className="flex items-center gap-1 rounded-xs border border-seam px-2 py-1 text-2xs text-fg-dim hover:text-fg"
          >
            <Undo2 size={10} /> check out
          </button>
          <button
            onClick={() => revert(selectedStep)}
            title="Check out here, then run an op to fork a branch"
            className="flex items-center gap-1 rounded-xs border border-seam px-2 py-1 text-2xs text-fg-dim hover:text-fg"
          >
            <GitBranch size={10} /> branch
          </button>
        </div>
      </div>
    ) : (
      <p className="text-2xs text-fg-faint">Step not found.</p>
    );
  } else {
    body = (
      <p className="text-2xs text-fg-faint">
        Click a channel, component, or pipeline step.
      </p>
    );
  }

  return (
    <div className="flex w-[172px] shrink-0 flex-col gap-2 border-l border-seam bg-bg p-2 max-[1100px]:hidden">
      <div className="flex items-center justify-between">
        <GroupLabel>{heading}</GroupLabel>
        {(focusChannel || component != null || selectedStep != null) && (
          <button
            className="text-2xs text-fg-faint hover:text-fg"
            onClick={() => { setFocusChannel(null); setSelectedStep(null); useStore.getState().setComponent(null); }}
          >
            clear
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </div>
  );
}
