import { useState } from "react";
import { Split, clamp } from "./Split";
import { Waveform } from "../panels/Waveform";
import { Minimap } from "../panels/Minimap";
import { ScalpField3D } from "../panels/ScalpField3D";
import { PSD } from "../panels/PSD";
import { BandHeatmap } from "../panels/BandHeatmap";
import { Ledger } from "../panels/Ledger";
import { useStore } from "../../store/store";
import { PANELS } from "./panelRegistry";

export function Terminal() {
  const preset = useStore((s) => s.preset);
  const focused = useStore((s) => s.focusedPanel);

  // resizable seams (px / fraction)
  const [wf, setWf] = useState(0.64);       // waveform width fraction of top row
  const [topH, setTopH] = useState(1.15);   // top row flex-grow (bottom row = 0.85)
  const [miniH, setMiniH] = useState(84);   // minimap strip height
  const [psdW, setPsdW] = useState(0.4);    // psd width fraction of bottom row
  const [ledgerW, setLedgerW] = useState(340);

  if (focused) {
    const def = PANELS.find((p) => p.id === focused);
    const Solo = def?.Component;
    return <div className="h-full w-full border-t border-seam">{Solo && <Solo />}</div>;
  }

  const report = preset === "report";
  const clean = preset === "clean";

  return (
    <div className="flex h-full w-full flex-col border-t border-seam">
      {/* top row */}
      <div className="flex min-h-0" style={{ flex: `${clean ? 3 : topH} 1 0%` }}>
        <div className="min-w-0" style={{ flex: `${wf} 1 0%` }}>
          <Waveform />
        </div>
        <Split axis="x" onDelta={(d) => setWf((v) => clamp(v + d / window.innerWidth, 0.3, 0.82))} />
        <div className="min-w-0" style={{ flex: `${1 - wf} 1 0%` }}>
          <ScalpField3D />
        </div>
      </div>

      {!clean && (
        <>
          <Split axis="y" onDelta={(d) => setTopH((v) => clamp(v + d / 200, 0.5, 2.2))} />
          {/* bottom row */}
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0" style={{ flex: `${psdW} 1 0%` }}>
              <PSD />
            </div>
            <Split axis="x" onDelta={(d) => setPsdW((v) => clamp(v + d / window.innerWidth, 0.22, 0.6))} />
            <div className="min-w-0 flex-1">
              <BandHeatmap />
            </div>
            <Split axis="x" onDelta={(d) => setLedgerW((v) => clamp(v - d, 220, 520))} />
            <div style={{ width: report ? 480 : ledgerW }}>
              <Ledger />
            </div>
          </div>
        </>
      )}

      <Split axis="y" onDelta={(d) => setMiniH((v) => clamp(v - d, 52, 200))} />
      <div style={{ height: miniH }}>
        <Minimap />
      </div>
    </div>
  );
}
