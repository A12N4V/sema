import { useRef, useState } from "react";
import { api } from "../api/client";
import { useSessionStore } from "../state/sessionStore";

export function UploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const setSession = useSessionStore((s) => s.setSession);
  const setLoading = useSessionStore((s) => s.setLoading);
  const setError = useSessionStore((s) => s.setError);
  const loading = useSessionStore((s) => s.loading);
  const error = useSessionStore((s) => s.error);

  async function handleFile(file: File) {
    setError(null);
    setLoading(true);
    try {
      const info = await api.uploadFile(file);
      setSession(info);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="upload-panel">
      <h1>EEGvis</h1>
      <p className="subtitle">Upload an EEG recording — EDF, BDF, FIF, GDF, or CNT.</p>
      <div
        className={`dropzone ${dragOver ? "dropzone-active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
      >
        {loading ? (
          <p>Loading…</p>
        ) : (
          <>
            <p>Drop a file here, or click to browse</p>
            <p className="dropzone-hint">.edf .bdf .fif .gdf .cnt</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".edf,.bdf,.fif,.gdf,.cnt"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
