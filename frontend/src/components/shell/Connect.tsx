import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { UploadCloud, Play, Loader2, Download } from "lucide-react";
import { api, type SessionInfo } from "../../api/client";
import { pollJob } from "../../lib/ops";
import { navigate } from "../../lib/router";
import { useStore } from "../../store/store";

const FORMATS = "EDF · BDF · GDF · FIF · BrainVision · EEGLAB · CNT · EGI · Persyst · SNIRF · CTF · KIT · EyeLink · Curry";

export function Connect() {
  const setSession = useStore((s) => s.setSession);
  const [busy, setBusy] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [datasets, setDatasets] = useState<{ name: string; label: string; modality: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.datasetCatalog().then((r) => setDatasets(r.datasets)).catch(() => {});
  }, []);

  const land = (s: SessionInfo) => {
    setSession(s);
    navigate(`/s/${s.session_id}`);
  };

  const run = async (key: string, fn: () => Promise<SessionInfo>) => {
    setBusy(key);
    try {
      land(await fn());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openDataset = async (name: string) => {
    setBusy(`ds:${name}`);
    try {
      const { job_id } = await api.openDataset(name);
      const job = await pollJob(job_id);
      land(job.result.session as SessionInfo);
    } catch (e) {
      toast.error(`${name}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-bg p-6">
      <div className="w-full max-w-[720px]">
        <div className="mb-1 flex items-baseline gap-2.5">
          <span className="text-lg font-semibold tracking-tight text-fg">EEGvis</span>
          <span className="text-sm text-fg-faint">a workbench over MNE-Python</span>
        </div>
        <div className="mb-5 h-px w-full bg-seam" />

        <div className="grid gap-4 sm:grid-cols-2">
          {/* open a file */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) run("upload", () => api.uploadFile(f));
            }}
            onClick={() => fileRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-sm border border-dashed px-6 py-10 text-center transition-colors ${
              drag ? "border-accent bg-accent/5" : "border-seam-bright hover:border-fg-faint"
            }`}
          >
            {busy === "upload" ? <Loader2 className="animate-spin text-fg-dim" /> : <UploadCloud className="text-fg-dim" />}
            <span className="text-sm text-fg-dim">Drop a recording, or click to browse</span>
            <span className="text-2xs leading-relaxed text-fg-faint">{FORMATS}</span>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && run("upload", () => api.uploadFile(e.target.files![0]))}
            />
          </div>

          {/* sample data */}
          <div className="flex flex-col gap-2 rounded-sm border border-seam bg-panel p-3">
            <button
              onClick={() => run("demo", api.demo)}
              disabled={!!busy}
              className="flex w-full items-center justify-center gap-2 rounded-xs border border-seam py-2 text-sm text-fg transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {busy === "demo" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              Synthetic sample (offline)
            </button>
            <div className="mt-1 text-2xs uppercase tracking-wide text-fg-faint">mne.datasets — first fetch downloads</div>
            {datasets.map((d) => (
              <button
                key={d.name}
                onClick={() => openDataset(d.name)}
                disabled={!!busy}
                title={d.label}
                className="flex items-center justify-between gap-2 rounded-xs border border-seam px-2 py-1.5 text-left text-xs text-fg-dim transition-colors hover:border-fg-faint hover:text-fg disabled:opacity-50"
              >
                <span className="truncate">{d.label}</span>
                {busy === `ds:${d.name}` ? (
                  <Loader2 size={11} className="shrink-0 animate-spin" />
                ) : (
                  <Download size={11} className="shrink-0 text-fg-faint" />
                )}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-4 text-2xs text-fg-faint">
          From a notebook: <code className="mono">eegvis.launch(raw)</code> · sessions are held in memory and expire after 2 h idle.
        </p>
      </div>
    </div>
  );
}
