import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Toaster, toast } from "sonner";
import { Connect } from "./components/shell/Connect";
import { Terminal } from "./components/shell/Terminal";
import { StatusTicker } from "./components/shell/StatusTicker";
import { Toolbar } from "./components/shell/Toolbar";
import { FKeyStrip } from "./components/shell/FKeyStrip";
import { Settings } from "./components/shell/Settings";
import { PANEL_BY_FKEY } from "./components/shell/panelRegistry";
import { api } from "./api/client";
import { useStore } from "./store/store";

function App() {
  const session = useStore((s) => s.session);
  const setSession = useStore((s) => s.setSession);
  const playing = useStore((s) => s.playing);
  const resolvedTheme = useStore((s) => s.resolvedTheme);
  const [booting, setBooting] = useState(true);
  const [wantConnect, setWantConnect] = useState(false);
  const bootedOnce = useRef(false);

  // keep "system" theme in sync with the OS
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => useStore.getState().syncSystemTheme();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // land straight in the workspace on the sample recording — no upload prompt
  useEffect(() => {
    if (bootedOnce.current || session) return;
    bootedOnce.current = true;
    api.demo()
      .then((s) => setSession(s))
      .catch(() => setWantConnect(true))
      .finally(() => setBooting(false));
  }, [session, setSession]);

  // global keybindings — media-style, not a command language
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      const s = useStore.getState();

      if (/^F[1-8]$/.test(e.key)) {
        const pid = PANEL_BY_FKEY[e.key];
        if (pid) { e.preventDefault(); s.focusPanel(s.focusedPanel === pid ? null : pid); }
        return;
      }
      if (e.key === "Escape" && s.focusedPanel) { s.focusPanel(null); return; }
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

  // session evicted (TTL, or a dev backend restart) — drop back to Connect
  useEffect(() => {
    const onLost = () => {
      if (useStore.getState().session) {
        useStore.getState().setSession(null);
        setWantConnect(true);
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
    const speed = 1;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const s = useStore.getState();
      const next = s.t + dt * speed;
      if (next >= (s.session?.duration_seconds ?? 0)) {
        s.setPlaying(false);
        return;
      }
      s.setCursor(next);
      if (next > s.windowStart + s.windowDuration * 0.85) {
        s.setWindow(next - s.windowDuration * 0.5);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg">
      {session ? (
        <>
          <StatusTicker onNewSession={() => { setSession(null); setWantConnect(true); }} />
          <Toolbar />
          <div className="min-h-0 flex-1">
            <Terminal />
          </div>
          <FKeyStrip />
        </>
      ) : booting && !wantConnect ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-dim">
          <Loader2 className="animate-spin" />
          <span className="text-sm">Loading sample recording…</span>
        </div>
      ) : (
        <Connect />
      )}
      <Settings />
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

export default App;
