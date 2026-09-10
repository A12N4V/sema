import { toast } from "sonner";
import { Undo2, GitBranch, X } from "lucide-react";
import { api } from "../../api/client";
import { runOp } from "../../lib/ops";
import { useStore } from "../../store/store";

/**
 * Transient selection actions. Replaces the always-on Inspector rail: nothing
 * is drawn until something is selected, and it never shows generated code -
 * the pipeline strip owns provenance, pipeline.py owns the script.
 */
export function SelectionBar() {
  const session = useStore((s) => s.session);
  const focusChannel = useStore((s) => s.focusChannel);
  const component = useStore((s) => s.component);
  const selectedStep = useStore((s) => s.selectedStep);
  const history = useStore((s) => s.history);
  const patchSession = useStore((s) => s.patchSession);
  const refreshHistory = useStore((s) => s.refreshHistory);
  const refreshGraph = useStore((s) => s.refreshGraph);
  const loadLayout = useStore((s) => s.loadLayout);

  const clear = () => {
    const s = useStore.getState();
    s.setFocusChannel(null);
    s.setSelectedStep(null);
    s.setComponent(null);
  };

  const checkout = async (seq: number) => {
    if (!session) return;
    try {
      patchSession(await api.revert(session.session_id, seq));
      await Promise.all([refreshHistory(), refreshGraph(), loadLayout()]);
      clear();
      toast.success(seq === 0 ? "Reverted to pristine" : `Checked out step ${seq}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!session) return null;

  let label: React.ReactNode = null;
  let actions: React.ReactNode = null;

  if (focusChannel) {
    const isBad = session.bads.includes(focusChannel);
    const type = session.channel_types[session.channel_names.indexOf(focusChannel)] ?? "eeg";
    label = (
      <>
        <span className="mono font-medium text-fg">{focusChannel}</span>
        <Dot />
        <span className="text-fg-faint">{type}</span>
        <Dot />
        <span className={isBad ? "text-alert" : "text-good"}>{isBad ? "bad" : "good"}</span>
      </>
    );
    actions = (
      <>
        <Action
          onClick={() => {
            const next = isBad
              ? session.bads.filter((b) => b !== focusChannel)
              : [...session.bads, focusChannel];
            runOp("set_bads", { bads: next }, isBad ? "Unmarked" : `Marked ${focusChannel} bad`);
          }}
        >
          {isBad ? "Unmark bad" : "Mark bad"}
        </Action>
        {isBad && session.has_montage && (
          <Action primary onClick={() => runOp("interpolate_bads", { reset_bads: true }, "Interpolated")}>
            Interpolate
          </Action>
        )}
      </>
    );
  } else if (component != null) {
    label = (
      <>
        <span className="mono font-medium text-fg">IC {component}</span>
        <Dot />
        <span className="text-fg-faint">double-click the card to toggle removal</span>
      </>
    );
  } else if (selectedStep != null) {
    const e = history.find((h) => h.seq === selectedStep);
    label = (
      <>
        <span className="mono font-medium text-fg">#{selectedStep}</span>
        <Dot />
        <span className="text-fg-dim">{e?.label ?? "step"}</span>
      </>
    );
    actions = (
      <>
        <Action icon={<Undo2 size={11} />} onClick={() => checkout(selectedStep)}>
          Check out
        </Action>
        <Action
          icon={<GitBranch size={11} />}
          title="Check out here, then run an op to fork a branch"
          onClick={() => checkout(selectedStep)}
        >
          Branch
        </Action>
      </>
    );
  } else {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center px-4">
      <div className="pop pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto py-1.5 pl-3 pr-1.5 text-xs">
        <div className="flex shrink-0 items-center gap-2">{label}</div>
        {actions && <span className="h-4 w-px shrink-0 bg-seam" />}
        {actions}
        <button
          onClick={clear}
          aria-label="Clear selection"
          className="shrink-0 rounded-xs p-1 text-fg-faint transition-colors hover:bg-panel-2 hover:text-fg"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

const Dot = () => <span className="text-fg-faint">·</span>;

function Action({
  children,
  onClick,
  icon,
  primary,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  icon?: React.ReactNode;
  primary?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={
        "flex shrink-0 items-center gap-1 rounded-xs border px-2 py-1 transition-colors " +
        (primary
          ? "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
          : "border-seam text-fg-dim hover:border-seam-bright hover:text-fg")
      }
    >
      {icon}
      {children}
    </button>
  );
}
