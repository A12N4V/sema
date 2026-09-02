import { useEffect, useState } from "react";
import Plot from "react-plotly.js";
import { api, type TraceWindow } from "../api/client";
import { useSessionStore } from "../state/sessionStore";

// Vertical spacing between stacked channel traces, in the same microvolt
// units the backend returns — this is the classic "butterfly" EEG viewer
// layout: each channel gets its own baseline offset so traces don't overlap.
const CHANNEL_OFFSET_UV = 100;

export function ChannelViewer() {
  const session = useSessionStore((s) => s.session);
  const selectedChannels = useSessionStore((s) => s.selectedChannels);
  const windowStart = useSessionStore((s) => s.windowStart);
  const windowDuration = useSessionStore((s) => s.windowDuration);
  const setWindow = useSessionStore((s) => s.setWindow);

  const [data, setData] = useState<TraceWindow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    api
      .getTraceWindow(session.session_id, {
        start: windowStart,
        duration: windowDuration,
        channels: selectedChannels.length ? selectedChannels : undefined,
        max_points: 2000,
      })
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [session, windowStart, windowDuration, selectedChannels]);

  if (!session) return null;
  if (error) return <p className="error-text">{error}</p>;
  if (!data) return <p>Loading trace…</p>;

  const traces = data.channels.map((ch, i) => {
    const offset = (data.channels.length - 1 - i) * CHANNEL_OFFSET_UV;
    return {
      x: data.time,
      y: data.traces[ch].map((v) => v + offset),
      type: "scattergl" as const,
      mode: "lines" as const,
      name: ch,
      line: { width: 1 },
      hovertemplate: `${ch}: %{customdata:.1f} µV<extra></extra>`,
      customdata: data.traces[ch],
    };
  });

  const tickvals = data.channels.map((_, i) => (data.channels.length - 1 - i) * CHANNEL_OFFSET_UV);

  return (
    <div className="channel-viewer">
      <div className="window-controls">
        <button
          onClick={() => setWindow(Math.max(0, windowStart - windowDuration), windowDuration)}
        >
          ← back
        </button>
        <span>
          {windowStart.toFixed(1)}s – {(windowStart + windowDuration).toFixed(1)}s
          {" / "}
          {session.duration_seconds.toFixed(1)}s
        </span>
        <button
          onClick={() =>
            setWindow(
              Math.min(session.duration_seconds - windowDuration, windowStart + windowDuration),
              windowDuration,
            )
          }
        >
          forward →
        </button>
        <label>
          window (s):
          <input
            type="number"
            min={1}
            max={60}
            value={windowDuration}
            onChange={(e) => setWindow(windowStart, Number(e.target.value) || 10)}
          />
        </label>
      </div>
      <Plot
        data={traces}
        layout={{
          autosize: true,
          height: Math.max(400, data.channels.length * 40),
          margin: { l: 60, r: 20, t: 10, b: 40 },
          xaxis: { title: { text: "Time (s)" } },
          yaxis: {
            tickvals,
            ticktext: data.channels,
            title: { text: "" },
          },
          showlegend: false,
          paper_bgcolor: "transparent",
          plot_bgcolor: "transparent",
        }}
        style={{ width: "100%" }}
        useResizeHandler
        config={{ displaylogo: false, responsive: true }}
      />
    </div>
  );
}
