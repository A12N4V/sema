import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { api } from "../api";
import { useStore } from "../store";
import { Empty } from "../ui/primitives";

export function Log() {
  const runId = useStore((s) => s.runId);
  const [text, setText] = useState("");
  const off = useRef(0);
  const box = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    setText(""); off.current = 0;
    if (!runId) return;
    let live = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const r = await api.log(runId, off.current).catch(() => null);
      if (!live) return;
      if (r?.text) { off.current = r.offset; setText((x) => (x + r.text).slice(-600_000)); }
      t = setTimeout(tick, 1000);
    };
    tick();
    return () => { live = false; clearTimeout(t); };
  }, [runId]);
  useEffect(() => { if (pinned.current && box.current) box.current.scrollTop = box.current.scrollHeight; }, [text]);
  if (!runId) return <Empty>Nothing has run yet. Choose inputs in the ribbon, then Start.</Empty>;
  return (
    <pre ref={box} onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
         className="code h-full overflow-auto whitespace-pre-wrap break-words p-3 text-fg-dim">
      {text.split("\n").map((l, i) => (
        <div key={i} className={clsx(
          l.startsWith("##HODOS") && "mt-2 border-t border-seam pt-2 text-accent",
          (l.startsWith("!!") || /\berror\b/i.test(l)) && "text-alert",
          /warn/i.test(l) && "text-warn",
          l.startsWith("[figure]") && "text-fg-faint",
        )}>{l || " "}</div>
      ))}
    </pre>
  );
}
