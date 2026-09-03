import type { ComponentType } from "react";
import { Waveform } from "../panels/Waveform";
import { Minimap } from "../panels/Minimap";
import { ScalpField3D } from "../panels/ScalpField3D";
import { PSD } from "../panels/PSD";
import { BandHeatmap } from "../panels/BandHeatmap";
import { ICA } from "../panels/ICA";
import { Ledger } from "../panels/Ledger";

export interface PanelDef {
  id: string;
  title: string;
  fkey: string;
  Component: ComponentType;
}

export const PANELS: PanelDef[] = [
  { id: "waveform", title: "Waveform", fkey: "F1", Component: Waveform },
  { id: "scalp", title: "Scalp field", fkey: "F2", Component: ScalpField3D },
  { id: "psd", title: "Spectrum", fkey: "F3", Component: PSD },
  { id: "band", title: "Band power", fkey: "F4", Component: BandHeatmap },
  { id: "ica", title: "ICA", fkey: "F5", Component: ICA },
  { id: "ledger", title: "History", fkey: "F6", Component: Ledger },
  { id: "minimap", title: "Overview", fkey: "F7", Component: Minimap },
];

export const PANEL_BY_FKEY = Object.fromEntries(PANELS.map((p) => [p.fkey, p.id]));
