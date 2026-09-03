import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Toaster, toast } from "sonner";
import { Connect } from "./components/shell/Connect";
import { Workspace } from "./components/shell/Workspace";
import { Settings } from "./components/shell/Settings";
import { CommandPalette } from "./components/ops/CommandPalette";
import { api } from "./api/client";
import { useStore } from "./store/store";
import { useRoute, navigate } from "./lib/router";

function App() {
  const route = useRoute();
  const session = useStore((s) => s.session);
  const setSession = useStore((s) => s.setSession);
  const playing = useStore((s) => s.playing);
  const resolvedTheme = useStore((s) => s.resolvedTheme);
  const [loadingSession, setLoadingSession] = useState(false);
  const attempted = useRef<string | null>(null);

  // keep "system" theme in sync with the OS
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => useStore.getState().syncSystemTheme();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // route → session: /s/:id with no matching session in the store → fetch it
  useEffect(() => {
    if (route.name !== "workspace") return;
    if (session?.session_id === route.sessionId) return;
    if (attempted.current === route.sessionId) return;
    attempted.current = route.sessionId;
    setLoadingSession(true);
    api.getSession(route.sessionId)
      .then((s) => setSession(s))
      .catch(() => { toast.error("Session not found — start a new one"); navigate("/connect", true); })
      .finally(() => setLoadingSession(false));
  }, [route, session, setSession]);

  // global keybindings
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (s.session) s.setPaletteOpen(!s.paletteOpen);
        return;
      }
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (!s.session) return;

      if (e.key === " ") { e.preventDefault(); s.setPlaying(!s.playing); }
      else if (e.key === "ArrowRight") { e.preventDefault(); if (e.shiftKey) s.nudgeCursor(1); else s.pageWindow(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); if (e.shiftKey) s.nudgeCursor(-1); else s.pageWindow(-1); }
      else if (e.key === "]") s.setWindow(s.windowStart, Math.min(60, s.windowDuration * 1.5));
      else if (e.key === "[") s.setWindow(s.windowStart, Math.max(1, s.windowDuration / 1.5));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // session evicted (TTL / dev restart) — back to Connect
  useEffect(() => {
    const onLost = () => {
      if (useStore.getState().session) {
        useStore.getState().setSession(null);
        attempted.current = null;
        navigate("/connect", true);
        toast.error("Session ended — reconnect to continue");
      }
    };
    window.addEventListener("eegvis:session-lost", onLost);
    return () => window.removeEventListener("eegvis:session-lost", onLost);
  }, []);

  // playback sweep
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const s = useStore.getState();
      const next = s.t + dt * s.speed;
      if (next >= (s.session?.duration_seconds ?? 0)) { s.setPlaying(false); return; }
      s.setCursor(next);
      if (next > s.windowStart + s.windowDuration * 0.85) s.setWindow(next - s.windowDuration * 0.5);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const newSession = () => { setSession(null); attempted.current = null; navigate("/connect"); };
  const inWorkspace = route.name === "workspace" && session?.session_id === route.sessionId;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg">
      {inWorkspace ? (
        <Workspace onNewSession={newSession} />
      ) : loadingSession ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-dim">
          <Loader2 className="animate-spin" />
          <span className="text-sm">Loading session…</span>
        </div>
      ) : (
        <Connect />
      )}
      <Settings />
      <PaletteMount />
      <Toaster
        theme={resolvedTheme}
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--color-panel)",
            border: "1px solid var(--color-seam-bright)",
            color: "var(--color-fg)",
            borderRadius: "var(--radius-sm)",
            fontSize: 12,
          },
        }}
      />
    </div>
  );
}

function PaletteMount() {
  const open = useStore((s) => s.paletteOpen);
  const setOpen = useStore((s) => s.setPaletteOpen);
  const hasSession = useStore((s) => !!s.session);
  if (!hasSession || !open) return null;
  return <CommandPalette onClose={() => setOpen(false)} />;
}

export default App;
