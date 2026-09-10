import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { figure, figureKey, nearestFrame, peek, type Spec } from "../../lib/figures";
import { useStore } from "../../store/store";

/**
 * A server-rendered figure (topomap / sensors / ICA panel) as an <img>.
 *
 * Three things it does that a bare <img src=…> would not:
 *
 *  - **draws in the app's ink.** The theme goes into the spec, so the server
 *    returns a transparent PNG with light labels on dark, dark on light.
 *  - **answers instantly while scrubbing.** If the spec is cursor-linked and
 *    the nearest precomputed frame is already in memory, that paints on the
 *    same tick; the exact frame swaps in when it arrives. The time is baked
 *    into the figure, so what you are looking at is never ambiguous.
 *  - **shares blobs.** Loading and lifetime live in lib/figures.ts, so two
 *    panes showing the same map fetch it once.
 */
export function RenderedImage({
  spec,
  deps,
  alt,
  debounceMs = 120,
}: {
  spec: Record<string, unknown>;
  deps: unknown[];
  alt: string;
  debounceMs?: number;
}) {
  const sessionId = useStore((s) => s.session?.session_id);
  const theme = useStore((s) => s.resolvedTheme);
  const frameTimes = useStore((s) => s.filmstrip?.times);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const full: Spec = useMemo(() => ({ ...spec, theme }), [figureKey(spec), theme]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = figureKey(full);

  // The nearest already-loaded frame from the precomputed grid, a synchronous
  // stand-in while the exact one is still in flight.
  const preview =
    typeof full.t === "number" && frameTimes?.length
      ? peek({ ...full, t: nearestFrame(frameTimes, full.t) })
      : undefined;

  useEffect(() => {
    if (!sessionId) return;
    const ready = peek(full);
    if (ready) {
      setUrl(ready);
      setLoading(false);
      setErr(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const next = await figure(sessionId, full);
        if (cancelled) return;
        setUrl(next);
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, key, ...deps]);

  if (err) {
    return <div className="flex h-full items-center justify-center p-4 text-center text-2xs text-alert">{err}</div>;
  }
  const shown = (loading && preview) || url || preview;
  return (
    <div className="relative flex h-full items-center justify-center p-1">
      {/* h/w-full, not max-h/max-w: `max-*` caps the image at its *intrinsic*
          size, so a 400px topomap sat in the middle of a 900px pane with black
          all around it and the panes looked half-finished. `object-contain`
          keeps the aspect ratio, so this scales up without distorting. */}
      {shown && <img src={shown} alt={alt} className="h-full w-full object-contain" />}
      {loading && !shown && (
        <Loader2 size={14} className="absolute right-2 top-2 animate-spin text-fg-faint" />
      )}
    </div>
  );
}
