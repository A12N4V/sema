import { useMemo, useState } from "react";
import {
  fromInput,
  humanize,
  resolveKind,
  toInput,
  type JsonSchema,
} from "../../lib/schemaForm";

export type { JsonSchema } from "../../lib/schemaForm";

const field =
  "w-full rounded-xs border border-seam bg-bg px-2 py-1.5 text-sm text-fg outline-none transition-colors focus:border-accent";

export function ParamForm({
  schema,
  submitLabel = "Run",
  busy = false,
  onSubmit,
}: {
  schema: JsonSchema;
  submitLabel?: string;
  busy?: boolean;
  onSubmit: (params: Record<string, unknown>) => void;
}) {
  const fields = useMemo(
    () =>
      Object.entries(schema.properties ?? {}).map(([key, prop]) => {
        const { kind, optional } = resolveKind(prop);
        return { key, prop, kind, optional };
      }),
    [schema],
  );

  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, toInput(f.kind, f.prop.default)])),
  );
  const set = (k: string, v: string | boolean) => setValues((prev) => ({ ...prev, [k]: v }));

  const submit = () => {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const val = fromInput(f.kind, values[f.key], f.optional);
      if (val !== undefined) out[f.key] = val;
    }
    onSubmit(out);
  };

  return (
    <div className="flex flex-col gap-3">
      {fields.length === 0 && <p className="text-xs text-fg-faint">No parameters.</p>}
      {fields.map(({ key, prop, kind }) => (
        <label key={key} className="block">
          <span className="mb-1 flex items-baseline justify-between">
            <span className="text-xs font-medium text-fg-dim">{prop.title || humanize(key)}</span>
            <span className="mono text-2xs text-fg-faint">{kind}</span>
          </span>
          {kind === "bool" ? (
            <label className="flex items-center gap-2 text-sm text-fg-dim">
              <input
                type="checkbox"
                checked={Boolean(values[key])}
                onChange={(e) => set(key, e.target.checked)}
              />
              {prop.description ?? key}
            </label>
          ) : prop.enum ? (
            <select className={field} value={String(values[key])} onChange={(e) => set(key, e.target.value)}>
              {prop.enum.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={field}
              value={String(values[key])}
              onChange={(e) => set(key, e.target.value)}
              placeholder={prop.default != null ? String(prop.default) : ""}
            />
          )}
          {prop.description && kind !== "bool" && (
            <span className="mt-1 block text-2xs text-fg-faint">{prop.description}</span>
          )}
        </label>
      ))}
      <button
        onClick={submit}
        disabled={busy}
        className="mt-1 w-full rounded-xs border border-accent/40 bg-accent/12 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
      >
        {busy ? "Running…" : submitLabel}
      </button>
    </div>
  );
}
