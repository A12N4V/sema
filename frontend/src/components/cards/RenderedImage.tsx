import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../../api/client";
import { useStore } from "../../store/store";

/**
 * A server-rendered figure (topomap / sensors / ICA panel) as an <img>.
 * Debounced, keeps the previous frame visible while the next renders
 * (so cursor-scrubbing a topomap doesn't flicker), revokes old object-URLs.
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
  const session = useStore((s) => s.session);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    const id = session?.session_id;
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const next = await api.render(id, spec);
        if (cancelled) {
          URL.revokeObjectURL(next);
          return;
        }
        if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
        lastUrl.current = next;
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
  }, [session?.session_id, ...deps]);

  useEffect(() => () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current); }, []);

  if (err) {
    return <div className="flex h-full items-center justify-center p-4 text-center text-2xs text-alert">{err}</div>;
  }
  return (
    <div className="relative flex h-full items-center justify-center p-1">
      {url && <img src={url} alt={alt} className="max-h-full max-w-full object-contain" />}
      {loading && (
        <Loader2 size={14} className="absolute right-2 top-2 animate-spin text-fg-faint" />
      )}
    </div>
  );
}
