import { useEffect, useState } from "react";
import { api, type Spec } from "../api";
import { useStore } from "../store";

/** Fetch a figure's spec; the gene figure refetches when the selected gene moves. */
export function useSpec(noun: string, fig: string | null, kind?: string) {
  const runId = useStore((s) => s.runId);
  const stamp = useStore((s) => s.run?.ledger.length + ":" + s.run?.status);
  const variant = useStore((s) => (fig ? s.variant[`${s.wfId}:${noun}:${fig}`] : undefined));
  const gene = useStore((s) => (kind === "gene" ? s.gene : null));
  const [spec, setSpec] = useState<Spec | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!runId || !fig) { setSpec(null); return; }
    let live = true;
    setLoading(true); setErr(null);
    api.figure(runId, noun, fig, variant, gene ?? undefined)
      .then((s) => { if (live) setSpec(s); })
      .catch((e) => { if (live) setErr(String(e.message ?? e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [runId, noun, fig, variant, gene, stamp]);
  return { spec, err, loading };
}
