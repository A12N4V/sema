import { useMemo } from "react";
import { Panel } from "./Panel";
import { usePanelData } from "./usePanelData";
import { Heatmap } from "../../lib/plot/Heatmap";
import { magma } from "../../lib/plot/scales";
import { api, type BandPowerResult } from "../../api/client";
import { useStore } from "../../store/store";
import { useSignatureKey } from "../../store/useSignatureKey";

const BAND_ORDER = ["delta", "theta", "alpha", "beta", "gamma"];
const BAND_SHORT = ["δ 1–4", "θ 4–8", "α 8–13", "β 13–30", "γ 30–45"];

export function BandHeatmap() {
  const session = useStore((s) => s.session);
  const band = useStore((s) => s.band);
  const focusChannel = useStore((s) => s.focusChannel);
  const setBand = useStore((s) => s.setBand);
  const setFocusChannel = useStore((s) => s.setFocusChannel);

  const id = session?.session_id;
  const sigKey = useSignatureKey();

  const { data, state, error } = usePanelData<BandPowerResult>(
    () => api.bandPower(id!),
    [id, sigKey],
    { enabled: !!id, label: "Band power" },
  );

  const { matrix, rowLabels } = useMemo(() => {
    if (!data) return { matrix: [] as number[][], rowLabels: [] as string[] };
    // log + per-band robust min-max (5th–95th pct) so one loud channel
    // doesn't flatten the rest of the column
    const cols = BAND_ORDER.map((b) => data.bands[b].map((v) => Math.log10(v + 1e-20)));
    const norm = cols.map((col) => {
      const s = [...col].sort((a, b) => a - b);
      const lo = s[Math.floor(s.length * 0.05)];
      const hi = s[Math.ceil(s.length * 0.95) - 1];
      return col.map((v) => (hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0.5));
    });
    const m = data.channels.map((_, ci) => norm.map((col) => col[ci]));
    return { matrix: m, rowLabels: data.channels };
  }, [data]);

  const colIdx = BAND_ORDER.indexOf(band);
  const rowIdx = data ? data.channels.indexOf(focusChannel ?? "") : -1;

  return (
    <Panel title="Band power" fkey="F4" state={state} error={error} emptyHint="Computing band power…"
    >
      {data && (
        <Heatmap
          matrix={matrix}
          rowLabels={rowLabels}
          colLabels={BAND_SHORT}
          domain={[0, 1]}
          colormap={magma}
          highlight={{ col: colIdx >= 0 ? colIdx : undefined, row: rowIdx >= 0 ? rowIdx : undefined }}
          onCell={(r, c) => {
            setBand(BAND_ORDER[c]);
            setFocusChannel(data.channels[r]);
          }}
        />
      )}
    </Panel>
  );
}
