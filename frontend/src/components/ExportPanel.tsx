import { api } from "../api/client";
import { useSessionStore } from "../state/sessionStore";

export function ExportPanel() {
  const session = useSessionStore((s) => s.session);
  if (!session) return null;

  return (
    <div className="panel">
      <h3>Export</h3>
      <p className="hint">Downloads reflect every filter / re-reference / ICA-apply step run so far.</p>
      <div className="form-row">
        <a href={api.exportRawUrl(session.session_id)} download>
          <button>Download cleaned Raw (.fif)</button>
        </a>
        <a href={api.exportEpochsUrl(session.session_id)} download>
          <button>Download Epochs (.fif)</button>
        </a>
      </div>
    </div>
  );
}
