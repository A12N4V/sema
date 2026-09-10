import { Panel } from "../panels/Panel";
import { ICA } from "../panels/ICA";
import { Wizard, type WizardStep } from "../ops/Wizard";
import { ParamForm, type JsonSchema } from "../ops/ParamForm";
import { runOp } from "../../lib/ops";
import { useStore } from "../../store/store";
import { useState } from "react";
import { api, type OpSchema } from "../../api/client";
import { useEffect } from "react";

/**
 * ICA container card. Until the prerequisites are met (montage + a ≥1 Hz
 * high-pass) it shows the setup wizard (P0.7); after that, the full ICA panel.
 */
export function ICACard() {
  const session = useStore((s) => s.session);
  const hasIca = useStore((s) => s.hasIca);
  const [fitOp, setFitOp] = useState<OpSchema | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listOps("raw").then((r) => setFitOp(r.operations.find((o) => o.id === "fit_ica") ?? null)).catch(() => {});
  }, []);

  if (!session) return <Panel paneId="ica" title="ICA"><div /></Panel>;

  const hasMontage = session.has_montage;
  const filtered = (session.highpass ?? 0) >= 1;
  const ready = hasMontage && filtered;

  if (hasIca || ready) return <ICA />;

  const steps: WizardStep[] = [
    {
      id: "montage",
      title: hasMontage ? "Montage set" : "Set a montage",
      done: hasMontage,
      body: ({ next }) => (
        <div className="flex flex-col gap-2 text-xs text-fg-dim">
          <span>ICA topographies need electrode positions.</span>
          <button
            className="self-start rounded-xs border border-accent/40 bg-accent/10 px-2.5 py-1 text-accent hover:bg-accent/20"
            onClick={async () => { setBusy(true); await runOp("set_montage", { montage_name: "standard_1020" }, "Montage set"); setBusy(false); next(); }}
          >
            Apply standard_1020
          </button>
        </div>
      ),
    },
    {
      id: "filter",
      title: filtered ? "High-passed ≥ 1 Hz" : "High-pass ≥ 1 Hz",
      done: filtered,
      body: ({ next }) => (
        <div className="flex flex-col gap-2 text-xs text-fg-dim">
          <span>ICA is unstable on slow drifts, filter first.</span>
          <button
            className="self-start rounded-xs border border-accent/40 bg-accent/10 px-2.5 py-1 text-accent hover:bg-accent/20"
            onClick={async () => { setBusy(true); await runOp("filter", { l_freq: 1.0, h_freq: 40.0 }, "Filtered 1–40 Hz"); setBusy(false); next(); }}
          >
            Band-pass 1–40 Hz
          </button>
        </div>
      ),
    },
    {
      id: "fit",
      title: "Fit ICA",
      done: false,
      body: () =>
        fitOp ? (
          <ParamForm
            schema={fitOp.params_schema as JsonSchema}
            submitLabel="Fit ICA"
            busy={busy}
            onSubmit={async (params) => { setBusy(true); await runOp("fit_ica", params, "ICA fitted"); setBusy(false); }}
          />
        ) : (
          <span className="text-xs text-fg-faint">loading…</span>
        ),
    },
  ];

  return (
    <Panel paneId="ica" title="ICA: setup">
      <div className="flex h-full items-start justify-center overflow-auto p-4">
        <Wizard title="Prepare for ICA" steps={steps} busy={busy} onClose={() => useStore.getState().setActiveContainer("raw")} />
      </div>
    </Panel>
  );
}
