import { useRef, useState } from "react";
import { toast } from "sonner";
import { UploadCloud, Play, Loader2 } from "lucide-react";
import { api } from "../../api/client";
import { useStore } from "../../store/store";

export function Connect() {
  const setSession = useStore((s) => s.setSession);
  const [busy, setBusy] = useState<null | "demo" | "upload">(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (kind: "demo" | "upload", fn: () => Promise<Parameters<typeof setSession>[0]>) => {
    setBusy(kind);
    try {
      setSession(await fn());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center bg-bg">
      <div className="w-[480px]">
        <div className="mb-1 flex items-baseline gap-2.5">
          <span className="text-lg font-semibold tracking-tight text-fg">EEGvis</span>
          <span className="text-sm text-fg-faint">MNE-Python, in a web UI</span>
        </div>
        <div className="mb-6 h-px w-full bg-seam" />

        <button
          onClick={() => run("demo", api.demo)}
          disabled={!!busy}
          className="flex w-full items-center justify-center gap-2 rounded-sm border border-seam bg-panel py-3 text-base text-fg transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {busy === "demo" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          Open the sample recording
        </button>
        <div className="mt-1.5 text-center text-xs text-fg-faint">synthetic 32-channel EEG — no file needed</div>

        <div className="my-5 flex items-center gap-3 text-xs text-fg-faint">
          <div className="h-px flex-1 bg-seam" /> or open your own <div className="h-px flex-1 bg-seam" />
        </div>

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
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-sm border border-dashed px-6 py-8 transition-colors ${
            drag ? "border-accent bg-accent/5" : "border-seam-bright hover:border-fg-faint"
          }`}
        >
          {busy === "upload" ? <Loader2 className="animate-spin text-fg-dim" /> : <UploadCloud className="text-fg-dim" />}
          <span className="text-sm text-fg-dim">Drop an EEG file, or click to browse</span>
          <span className="text-2xs text-fg-faint">EDF · BDF · FIF · GDF · CNT</span>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".edf,.bdf,.fif,.gdf,.cnt"
            onChange={(e) => e.target.files?.[0] && run("upload", () => api.uploadFile(e.target.files![0]))}
          />
        </div>
      </div>
    </div>
  );
}
