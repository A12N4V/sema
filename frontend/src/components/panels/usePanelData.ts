import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError } from "../../api/client";

export type PanelState = "loading" | "stale" | "error" | "ready";

interface Opts {
  debounceMs?: number;
  /** skip fetching entirely (e.g. no session yet) */
  enabled?: boolean;
  label?: string;
}

export function usePanelData<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  { debounceMs = 120, enabled = true, label }: Opts = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<PanelState>("loading");
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const hasData = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setState("loading");
      return;
    }
    const ac = new AbortController();
    setState(hasData.current ? "stale" : "loading");
    const timer = setTimeout(async () => {
      try {
        const result = await fetcherRef.current(ac.signal);
        if (ac.signal.aborted) return;
        setData(result);
        hasData.current = true;
        setError(null);
        setState("ready");
      } catch (e) {
        if (ac.signal.aborted || (e as Error).name === "AbortError") return;
        const msg = e instanceof ApiError ? e.message : (e as Error).message;
        setError(msg);
        setState(hasData.current ? "stale" : "error");
        if (!(e instanceof ApiError && e.status === 404)) {
          toast.error(label ? `${label}: ${msg}` : msg);
        }
      }
    }, debounceMs);
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return { data, state, error };
}
