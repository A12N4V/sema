import type { ComponentType } from "react";
import { Waveform } from "../panels/Waveform";
import { PSD } from "../panels/PSD";
import { BandHeatmap } from "../panels/BandHeatmap";
import { Minimap } from "../panels/Minimap";
import { SensorsCard } from "./SensorsCard";
import { TopographyCard } from "./TopographyCard";
import { Field3DCard } from "./Field3DCard";
import { ICACard } from "./ICACard";

export interface CardDef {
  id: string;
  title: string;
  container: string;            // ContainerKind this card belongs to
  Component: ComponentType;
  /** grid span in the canvas */
  span?: { col?: number; row?: number };
}

export const CARDS: CardDef[] = [
  { id: "waveform", title: "Waveform", container: "raw", Component: Waveform, span: { col: 2, row: 2 } },
  { id: "topography", title: "Topography", container: "raw", Component: TopographyCard },
  { id: "field3d", title: "3D field", container: "raw", Component: Field3DCard, span: { row: 2 } },
  { id: "sensors", title: "Sensors", container: "raw", Component: SensorsCard },
  { id: "psd", title: "Spectrum", container: "raw", Component: PSD },
  { id: "bandpower", title: "Band power", container: "raw", Component: BandHeatmap },
  { id: "ica", title: "ICA", container: "ica", Component: ICACard, span: { col: 3, row: 2 } },
  { id: "minimap", title: "Overview", container: "raw", Component: Minimap },
];

export const CARD_BY_ID: Record<string, CardDef> = Object.fromEntries(CARDS.map((c) => [c.id, c]));

export const cardsFor = (container: string) => CARDS.filter((c) => c.container === container);

/** Default layouts per container — a "preset" is just an ordered list of card ids. */
export interface Preset {
  name: string;
  cards: string[];
  /** "workstation" = the fixed 2-pane layout; otherwise the modular grid */
  layout?: "workstation" | "grid";
}

export const PRESETS: Record<string, Preset[]> = {
  raw: [
    { name: "Workstation", cards: [], layout: "workstation" },
    { name: "Clean", cards: ["waveform", "topography", "field3d", "psd", "bandpower"] },
    { name: "Spectral", cards: ["psd", "bandpower", "topography"] },
    { name: "Review", cards: ["waveform", "sensors"] },
  ],
  ica: [{ name: "Components", cards: ["ica"] }],
  epochs: [{ name: "Epochs", cards: [] }],
};

export const defaultCards = (container: string): string[] =>
  PRESETS[container]?.[0]?.cards ?? cardsFor(container).map((c) => c.id);

export const defaultPreset = (container: string): Preset | undefined => PRESETS[container]?.[0];
