import { useSessionStore } from "../state/sessionStore";

export function InfoPanel() {
  const session = useSessionStore((s) => s.session);
  if (!session) return null;

  return (
    <div className="info-panel">
      <h2 title={session.filename}>{session.filename}</h2>
      <dl>
        <dt>Channels</dt>
        <dd>{session.n_channels}</dd>
        <dt>Sample rate</dt>
        <dd>{session.sfreq} Hz</dd>
        <dt>Duration</dt>
        <dd>{session.duration_seconds.toFixed(1)} s</dd>
        <dt>Filter band</dt>
        <dd>
          {session.highpass ?? "—"} – {session.lowpass ?? "—"} Hz
        </dd>
        <dt>Bad channels</dt>
        <dd>{session.bads.length ? session.bads.join(", ") : "none"}</dd>
        <dt>Montage</dt>
        <dd>{session.has_montage ? "set" : "not set"}</dd>
        <dt>Annotations</dt>
        <dd>{session.annotations.length}</dd>
      </dl>
    </div>
  );
}
