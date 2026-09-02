import { UploadPanel } from "./components/UploadPanel";
import { InfoPanel } from "./components/InfoPanel";
import { ChannelViewer } from "./components/ChannelViewer";
import { PreprocessPanel } from "./components/PreprocessPanel";
import { ICAPanel } from "./components/ICAPanel";
import { SpectralPanel } from "./components/SpectralPanel";
import { ExportPanel } from "./components/ExportPanel";
import { useSessionStore, type Step } from "./state/sessionStore";
import "./App.css";

const STEPS: { id: Step; label: string }[] = [
  { id: "viewer", label: "Viewer" },
  { id: "preprocess", label: "Preprocess" },
  { id: "ica", label: "ICA" },
  { id: "spectral", label: "Spectral" },
  { id: "export", label: "Export" },
];

function App() {
  const session = useSessionStore((s) => s.session);
  const step = useSessionStore((s) => s.step);
  const setStep = useSessionStore((s) => s.setStep);
  const error = useSessionStore((s) => s.error);
  const reset = useSessionStore((s) => s.reset);

  if (!session) {
    return (
      <div className="app app-centered">
        <UploadPanel />
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand" onClick={reset} role="button">
          EEGvis
        </div>
        <InfoPanel />
        <nav>
          {STEPS.map((s) => (
            <button key={s.id} className={s.id === step ? "nav-active" : ""} onClick={() => setStep(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        {error && <p className="error-text error-banner">{error}</p>}
        {step === "viewer" && <ChannelViewer />}
        {step === "preprocess" && <PreprocessPanel />}
        {step === "ica" && <ICAPanel />}
        {step === "spectral" && <SpectralPanel />}
        {step === "export" && <ExportPanel />}
      </main>
    </div>
  );
}

export default App;
