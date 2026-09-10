/** Human names for pane ids: used by the maximized banner and elsewhere a
 *  pane needs a display name. Kept out of Maximized.tsx so that file exports
 *  only the component (fast refresh wants one thing per file). */
export const PANE_LABEL: Record<string, string> = {
  waveform: "Waveform",
  visuals: "Visualizations",
  "visuals-a": "Visualization A",
  "visuals-b": "Visualization B",
  ica: "ICA",
  source: "Source",
  channels: "Channels",
  annotations: "Annotations",
  epochs: "Epochs",
  evoked: "Evoked",
  tfr: "Time-frequency",
};
