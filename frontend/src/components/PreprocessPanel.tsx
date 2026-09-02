import { useState } from "react";
import { api } from "../api/client";
import { useSessionStore } from "../state/sessionStore";

export function PreprocessPanel() {
  const session = useSessionStore((s) => s.session);
  const updateSession = useSessionStore((s) => s.updateSession);
  const setError = useSessionStore((s) => s.setError);
  const [lFreq, setLFreq] = useState(1);
  const [hFreq, setHFreq] = useState(40);
  const [notchFreq, setNotchFreq] = useState(60);
  const [resampleTo, setResampleTo] = useState(250);
  const [badInput, setBadInput] = useState("");
  const [busy, setBusy] = useState(false);

  if (!session) return null;

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setError(null);
    try {
      const info = await fn();
      // every preprocessing endpoint returns the fresh SessionInfo
      updateSession(info as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>Filtering</h3>
      <div className="form-row">
        <label>
          High-pass (Hz)
          <input type="number" value={lFreq} onChange={(e) => setLFreq(Number(e.target.value))} />
        </label>
        <label>
          Low-pass (Hz)
          <input type="number" value={hFreq} onChange={(e) => setHFreq(Number(e.target.value))} />
        </label>
        <button disabled={busy} onClick={() => run(() => api.applyBandpass(session.session_id, lFreq, hFreq))}>
          Apply band-pass
        </button>
      </div>

      <div className="form-row">
        <label>
          Notch (Hz)
          <input type="number" value={notchFreq} onChange={(e) => setNotchFreq(Number(e.target.value))} />
        </label>
        <button disabled={busy} onClick={() => run(() => api.applyNotch(session.session_id, [notchFreq]))}>
          Apply notch
        </button>
      </div>

      <h3>Resample</h3>
      <div className="form-row">
        <label>
          Target sfreq (Hz)
          <input type="number" value={resampleTo} onChange={(e) => setResampleTo(Number(e.target.value))} />
        </label>
        <button disabled={busy} onClick={() => run(() => api.applyResample(session.session_id, resampleTo))}>
          Resample
        </button>
      </div>

      <h3>Reference &amp; montage</h3>
      <div className="form-row">
        <button disabled={busy} onClick={() => run(() => api.setReference(session.session_id, "average"))}>
          Common average reference
        </button>
        <button disabled={busy} onClick={() => run(() => api.setMontage(session.session_id, "standard_1020"))}>
          Set standard_1020 montage
        </button>
      </div>

      <h3>Bad channels</h3>
      <div className="form-row">
        <label>
          Comma-separated channel names
          <input
            type="text"
            value={badInput}
            placeholder={session.channel_names.slice(0, 3).join(", ")}
            onChange={(e) => setBadInput(e.target.value)}
          />
        </label>
        <button
          disabled={busy}
          onClick={() =>
            run(() =>
              api.setBadChannels(
                session.session_id,
                badInput.split(",").map((s) => s.trim()).filter(Boolean),
              ),
            )
          }
        >
          Mark bad
        </button>
      </div>
    </div>
  );
}
