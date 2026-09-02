import { useState } from "react";
import { api } from "../api/client";
import { useSessionStore } from "../state/sessionStore";

export function ICAPanel() {
  const session = useSessionStore((s) => s.session);
  const setError = useSessionStore((s) => s.setError);
  const icaComponents = useSessionStore((s) => s.icaComponents);
  const setIcaComponents = useSessionStore((s) => s.setIcaComponents);

  const [nComponents, setNComponents] = useState(15);
  const [busy, setBusy] = useState(false);
  const [topomaps, setTopomaps] = useState<Record<number, string>>({});

  if (!session) return null;

  async function fit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.fitIca(session!.session_id, nComponents);
      setIcaComponents(res.components);
      setTopomaps({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadTopomap(index: number) {
    if (topomaps[index]) return;
    try {
      const res = await api.getIcaTopomap(session!.session_id, index);
      setTopomaps((prev) => ({ ...prev, [index]: res.png_base64 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function toggleExclude(index: number) {
    const nextExcluded = icaComponents.map((c) => (c.index === index ? { ...c, excluded: !c.excluded } : c));
    setIcaComponents(nextExcluded);
    try {
      const excludeList = nextExcluded.filter((c) => c.excluded).map((c) => c.index);
      await api.setIcaExclusions(session!.session_id, excludeList);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function applyAndRemove() {
    setBusy(true);
    setError(null);
    try {
      await api.applyIca(session!.session_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>ICA</h3>
      <p className="hint">
        Requires a montage — set one under Preprocess first if topomaps come back empty.
      </p>
      <div className="form-row">
        <label>
          Components (int count, or 0–1 for variance fraction)
          <input type="number" value={nComponents} onChange={(e) => setNComponents(Number(e.target.value))} />
        </label>
        <button disabled={busy} onClick={fit}>
          Fit ICA
        </button>
      </div>

      {icaComponents.length > 0 && (
        <>
          <div className="ica-grid">
            {icaComponents.map((c) => (
              <div
                key={c.index}
                className={`ica-component ${c.excluded ? "ica-component-excluded" : ""}`}
                onMouseEnter={() => void loadTopomap(c.index)}
                onClick={() => void toggleExclude(c.index)}
                title="Click to toggle exclusion"
              >
                <div className="ica-thumb">
                  {topomaps[c.index] ? (
                    <img src={`data:image/png;base64,${topomaps[c.index]}`} alt={`IC${c.index}`} />
                  ) : (
                    <span className="ica-thumb-placeholder">IC{c.index}</span>
                  )}
                </div>
                <div className="ica-label">
                  IC{c.index}
                  {c.variance_explained != null && ` · ${(c.variance_explained * 100).toFixed(1)}%`}
                  {c.excluded && " · excluded"}
                </div>
              </div>
            ))}
          </div>
          <button disabled={busy} onClick={applyAndRemove}>
            Apply — remove excluded components
          </button>
        </>
      )}
    </div>
  );
}
