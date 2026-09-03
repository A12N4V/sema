import { useMemo } from "react";
import { Panel } from "./Panel";
import { usePanelData } from "./usePanelData";
import { LinePlot, type Series, type VBand } from "../../lib/plot/LinePlot";
import { api, type PSDResult } from "../../api/client";
import { useStore } from "../../store/store";
import { useSignatureKey } from "../../store/useSignatureKey";

const BANDS: VBand[] = [
  { from: 1, to: 4, color: "rgba(79,176,255,0.04)", label: "δ" },
  { from: 4, to: 8, color: "rgba(79,176,255,0.07)", label: "θ" },
  { from: 8, to: 13, color: "rgba(79,176,255,0.11)", label: "α" },
  { from: 13, to: 30, color: "rgba(79,176,255,0.06)", label: "β" },
  { from: 30, to: 45, color: "rgba(79,176,255,0.03)", label: "γ" },
];

export function PSD() {
  const session = useStore((s) => s.session);
  const selected = useStore((s) => s.selectedChannels);
  const focusChannel = useStore((s) => s.focusChannel);
  const setBand = useStore((s) => s.setBand);

  const id = session?.session_id;
  const sigKey = useSignatureKey();
  const picks = selected.length ? selected : session?.channel_names ?? [];

  const { data, state, error } = usePanelData<PSDResult>(
    () => api.psd(id!, 1, 45, picks),
    [id, sigKey, picks.join(",")],
    { enabled: !!id, label: "PSD" },
  );

  const series = useMemo<Series[]>(() => {
    if (!data) return [];
    const { freqs, channels, psd_db } = data;
    const mean = freqs.map((_, fi) => psd_db.reduce((a, row) => a + row[fi], 0) / channels.length);
    const out: Series[] = [];
    // faint per-channel
    for (let i = 0; i < channels.length && i < 40; i++) {
      out.push({ id: channels[i], x: freqs, y: psd_db[i], color: "rgba(120,120,132,0.28)", width: 0.6 });
    }
    // focus channel highlighted
    const fi = channels.indexOf(focusChannel ?? "");
    if (fi >= 0) out.push({ id: "focus", x: freqs, y: psd_db[fi], color: "#4fb0ff", width: 1.4 });
    // mean
    out.push({ id: "mean", x: freqs, y: mean, color: "#d7d7d7", width: 1.6 });
    return out;
  }, [data, focusChannel]);

  const bandForFreq = (f: number) =>
    f < 4 ? "delta" : f < 8 ? "theta" : f < 13 ? "alpha" : f < 30 ? "beta" : "gamma";

  return (
    <Panel title="Spectrum" fkey="F3" state={state} error={error} emptyHint="Computing PSD…"
      right={<span className="mono text-2xs text-fg-faint">{picks.length} ch</span>}
    >
      {data && (
        <LinePlot
          series={series}
          xDomain={[1, 45]}
          logX
          xLabel="Hz"
          yLabel="dB µV²/Hz"
          bands={BANDS}
          onClickX={(f) => setBand(bandForFreq(f))}
        />
      )}
    </Panel>
  );
}
