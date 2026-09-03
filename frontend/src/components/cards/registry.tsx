import type { ComponentType } from "react";
import { Waveform } from "../panels/Waveform";
import { PSD } from "../panels/PSD";
import { BandHeatmap } from "../panels/BandHeatmap";
import { Minimap } from "../panels/Minimap";
import { ICA } from "../panels/ICA";
import { SensorsCard } from "./SensorsCard";
import { TopographyCard } from "./TopographyCard";

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
  { id: "sensors", title: "Sensors", container: "raw", Component: SensorsCard },
  { id: "psd", title: "Spectrum", container: "raw", Component: PSD },
  { id: "bandpower", title: "Band power", container: "raw", Component: BandHeatmap },
  { id: "ica", title: "ICA", container: "ica", Component: ICA, span: { col: 3, row: 2 } },
  { id: "minimap", title: "Overview", container: "raw", Component: Minimap },
];

export const CARD_BY_ID: Record<string, CardDef> = Object.fromEntries(CARDS.map((c) => [c.id, c]));

export const cardsFor = (container: string) => CARDS.filter((c) => c.container === container);

/** Default layouts per container — a "preset" is just an ordered list of card ids. */
export const PRESETS: Record<string, { name: string; cards: string[] }[]> = {
  raw: [
    { name: "Clean", cards: ["waveform", "topography", "psd", "bandpower"] },
    { name: "Spectral", cards: ["psd", "bandpower", "topography"] },
    { name: "Review", cards: ["waveform", "sensors"] },
  ],
  ica: [{ name: "Components", cards: ["ica"] }],
  epochs: [{ name: "Epochs", cards: [] }],
};

export const defaultCards = (container: string): string[] =>
  PRESETS[container]?.[0]?.cards ?? cardsFor(container).map((c) => c.id);
