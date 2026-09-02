import { useState } from "react";
import Plot from "react-plotly.js";
import { api, type PSDResult, type BandPowerResult } from "../api/client";
import { useSessionStore } from "../state/sessionStore";

const BAND_NAMES = ["delta", "theta", "alpha", "beta", "gamma"];

export function SpectralPanel() {
  const session = useSessionStore((s) => s.session);
  const setError = useSessionStore((s) => s.setError);
  const [psd, setPsd] = useState<PSDResult | null>(null);
  const [bandPower, setBandPower] = useState<BandPowerResult | null>(null);
  const [selectedBand, setSelectedBand] = useState("alpha");
  const [topomapB64, setTopomapB64] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!session) return null;

  async function loadPsd() {
    setBusy(true);
    setError(null);
    try {
      setPsd(await api.getPsd(session!.session_id, 1, 45));
      setBandPower(await api.getBandPower(session!.session_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadTopomap(band: string) {
    setSelectedBand(band);
    setError(null);
    try {
      const res = await api.getBandTopomap(session!.session_id, band);
      setTopomapB64(res.png_base64);
    } catch (e) {
      setTopomapB64(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="panel">
      <h3>Spectral</h3>
      <button disabled={busy} onClick={loadPsd}>
        Compute PSD (1–45 Hz)
      </button>

      {psd && (
        <Plot
          data={psd.channels.map((ch, i) => ({
            x: psd.freqs,
            y: psd.psd_db[i],
            type: "scatter" as const,
            mode: "lines" as const,
            name: ch,
            line: { width: 1 },
          }))}
          layout={{
            autosize: true,
            height: 320,
            margin: { l: 50, r: 20, t: 10, b: 40 },
            xaxis: { title: { text: "Frequency (Hz)" } },
            yaxis: { title: { text: "Power (dB µV²/Hz)" } },
            paper_bgcolor: "transparent",
            plot_bgcolor: "transparent",
            legend: { font: { size: 10 } },
          }}
          style={{ width: "100%" }}
          useResizeHandler
          config={{ displaylogo: false, responsive: true }}
        />
      )}

      {bandPower && (
        <>
          <h4>Band topomap</h4>
          <div className="form-row">
            {BAND_NAMES.map((band) => (
              <button
                key={band}
                className={band === selectedBand ? "active" : ""}
                onClick={() => void loadTopomap(band)}
              >
                {band}
              </button>
            ))}
          </div>
          {topomapB64 && <img className="topomap-img" src={`data:image/png;base64,${topomapB64}`} alt={selectedBand} />}
        </>
      )}
    </div>
  );
}
