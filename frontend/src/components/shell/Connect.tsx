import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { UploadCloud, Play, Loader2, Download, ArrowRight, PlugZap } from "lucide-react";
import { api, type SessionInfo } from "../../api/client";
import { pollJob } from "../../lib/ops";
import { navigate } from "../../lib/router";
import { useStore } from "../../store/store";
import { Mark } from "../ui/Brand";
import { SignalField } from "../ui/SignalField";

const FORMATS = "EDF · BDF · GDF · FIF · BrainVision · EEGLAB · CNT · EGI · Persyst · SNIRF · CTF · KIT · EyeLink · Curry";

/** "4m ago" / "3h ago" / "2d ago", from a unix timestamp in seconds. */
function ago(saved: number): string {
  const s = Date.now() / 1000 - saved;
  if (!isFinite(s) || s < 0) return "";
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

type Reach = "checking" | "up" | "down";

export function Connect() {
  const setSession = useStore((s) => s.setSession);
  const [busy, setBusy] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [datasets, setDatasets] = useState<{ name: string; label: string; modality: string }[]>([]);
  const [recent, setRecent] = useState<{ session_id: string; filename: string; saved_at: number; steps: number }[]>([]);
  const [stats, setStats] = useState<{ ops: number; stages: number } | null>(null);
  const [reach, setReach] = useState<Reach>("checking");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    /**
     * One probe for the whole launcher, and it is allowed to fail *visibly*.
     *
     * These were three independent `.catch(() => {})`s. With the server down
     * that renders a heading promising sample datasets above an empty box, and
     * a capability line that silently loses half its content: the page looks
     * like the product is broken rather than like the backend is not running.
     * Now one failure sets `reach`, and the page says so with the command that
     * fixes it. `recent` keeps its own catch because an unreadable session
     * bundle is not the same thing as an unreachable server.
     */
    let live = true;
    Promise.all([api.datasetCatalog(), api.listOps(), api.recent().catch(() => ({ recent: [] }))])
      .then(([ds, ops, rec]) => {
        if (!live) return;
        setDatasets(ds.datasets);
        // read from the registry, so this line cannot drift from what the app does
        setStats({ ops: ops.operations.length, stages: new Set(ops.operations.map((o) => o.stage)).size });
        setRecent(rec.recent);
        setReach("up");
      })
      .catch(() => live && setReach("down"));
    return () => { live = false; };
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
    // `items-start` + `my-auto`, not `items-center`: a centred flex child that
    // outgrows its scroll container has its overflow clipped at the *top* and
    // becomes unreachable, which used to hide the wordmark behind a long
    // recents list. Auto margins centre it while it fits and let it scroll
    // normally once it does not.
    <div className="relative flex h-full w-full items-start justify-center overflow-y-auto bg-bg">
      <SignalField />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-bg/35 to-bg/95" />

      <div className="relative my-auto w-full max-w-[680px] px-6 py-12">
        {/* ---- the mark, centred, carrying the identity on its own ---- */}
        <div className="mb-8 flex flex-col items-center text-center">
          {/* 96, not 54: above the threshold in `Mark` this renders the full
              source estimate with its sulcal shading, and the launcher is the one
              place with room to show what the tool actually produces. */}
          <Mark size={96} />
          {/* The name is set in the mono face with wide tracking, which is the
              app's *data* voice rather than its prose voice. That is the one
              distinction the type system already makes everywhere else, so the
              wordmark reading as an instrument label is the point. The left
              padding compensates for the trailing letter-space, which would
              otherwise push the centred word visibly off-axis. */}
          <h1 className="mono mt-3.5 text-[30px] font-medium uppercase leading-none tracking-[0.36em] text-fg">
            <span className="pl-[0.36em]">Sema</span>
          </h1>
          {/* The subtitle is the Greek alone. It used to gloss itself and then
              explain the product in the same breath, which is two jobs for one
              line and left the mark and the wordmark competing with prose. The
              word is the whole point of the name; let it sit there. */}
          <p className="mt-3 text-lg italic leading-none text-fg-dim">σῆμα</p>
        </div>

        {/* the capability line: read from the live registry, not typed here */}
        <div className="mb-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-y border-seam py-2 text-2xs uppercase tracking-[0.18em] text-fg-faint">
          {stats && (
            <>
              <span className="mono tabular-nums tracking-normal text-fg-dim">{stats.ops} operations</span>
              <span className="mono tabular-nums tracking-normal text-fg-dim">{stats.stages} stages</span>
            </>
          )}
          <span>reproducible</span>
          <span>local</span>
        </div>

        {reach === "down" && (
          <div className="mb-4 flex items-start gap-2.5 rounded-sm border border-alert/40 bg-alert/10 p-3">
            <PlugZap size={14} className="mt-0.5 shrink-0 text-alert" />
            <div className="text-xs leading-relaxed text-fg-dim">
              <div className="font-medium text-fg">No API on port 8123</div>
              Sample datasets and recent sessions cannot load. Start the backend with{" "}
              <code className="mono rounded-xs bg-panel-2 px-1 py-0.5 text-fg-dim">./dev.sh</code>, then reload.
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
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
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-sm border border-dashed bg-panel/40 px-6 py-9 text-center backdrop-blur-[2px] transition-colors ${
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
          <div className="flex flex-col gap-2 rounded-sm border border-seam bg-panel/80 p-3 backdrop-blur-[2px]">
            <button
              onClick={() => run("demo", api.demo)}
              disabled={!!busy}
              className="flex w-full items-center justify-center gap-2 rounded-xs border border-accent-dim bg-accent/10 py-2 text-sm font-medium text-fg transition-colors hover:border-accent hover:bg-accent/20 disabled:opacity-50"
            >
              {busy === "demo" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              Synthetic sample (offline)
            </button>

            {/* The caption only appears with something under it. It used to be
                static, so a failed fetch left it heading an empty box. */}
            {reach === "checking" && (
              <div className="mt-1 flex items-center gap-1.5 text-2xs uppercase tracking-wide text-fg-faint">
                <Loader2 size={10} className="animate-spin" /> loading datasets
              </div>
            )}
            {datasets.length > 0 && (
              <div className="mt-1 text-2xs uppercase tracking-wide text-fg-faint">
                mne.datasets, first fetch downloads
              </div>
            )}
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

        {recent.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 text-2xs uppercase tracking-wide text-fg-faint">Pick up where you left off</div>
            <div className="flex flex-col gap-1">
              {recent.map((r) => (
                <button
                  key={r.session_id}
                  onClick={() => navigate(`/s/${r.session_id}`)}
                  className="group flex items-center gap-2 rounded-xs border border-seam bg-panel/60 px-2.5 py-1.5 text-left text-xs text-fg-dim backdrop-blur-[2px] transition-colors hover:border-fg-faint hover:text-fg"
                >
                  <span className="mono min-w-0 flex-1 truncate">{r.filename}</span>
                  <span className="shrink-0 tabular-nums text-fg-faint">
                    {r.steps} step{r.steps === 1 ? "" : "s"}
                  </span>
                  <span className="shrink-0 tabular-nums text-fg-faint max-[420px]:hidden">{ago(r.saved_at)}</span>
                  <ArrowRight size={11} className="shrink-0 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-2xs leading-relaxed text-fg-faint">
          <code className="mono text-fg-dim">sema.launch(raw)</code> from a notebook · nothing leaves this machine
        </p>
      </div>
    </div>
  );
}
