import { useMemo, useState } from "react";

/* ------------------------------------------------------------------ schema */
/** The subset of JSON Schema (Pydantic v2 `model_json_schema()`) we render. */
interface PropSchema {
  type?: string;
  anyOf?: PropSchema[];
  items?: PropSchema;
  enum?: string[];
  default?: unknown;
  description?: string;
  title?: string;
}
export interface JsonSchema {
  properties?: Record<string, PropSchema>;
  required?: string[];
}

type Kind = "number" | "string" | "bool" | "num-list" | "str-list" | "str-or-list" | "json";

function resolve(p: PropSchema): { kind: Kind; optional: boolean } {
  if (p.anyOf && p.anyOf.length) {
    const optional = p.anyOf.some((x) => x.type === "null");
    const nn = p.anyOf.filter((x) => x.type !== "null");
    if (nn.length === 1) return { kind: resolve(nn[0]).kind, optional };
    const types = nn.map((x) => x.type);
    if (types.includes("string") && types.includes("array")) return { kind: "str-or-list", optional };
    if (types.includes("number") || types.includes("integer")) return { kind: "number", optional };
    return { kind: "json", optional };
  }
  if (p.enum) return { kind: "string", optional: false };
  switch (p.type) {
    case "number":
    case "integer":
      return { kind: "number", optional: false };
    case "boolean":
      return { kind: "bool", optional: false };
    case "string":
      return { kind: "string", optional: false };
    case "array":
      return { kind: p.items?.type === "string" ? "str-list" : "num-list", optional: false };
    default:
      return { kind: "json", optional: false };
  }
}

const humanize = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function toInput(kind: Kind, v: unknown): string | boolean {
  if (kind === "bool") return Boolean(v);
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function fromInput(kind: Kind, raw: string | boolean, optional: boolean): unknown {
  if (kind === "bool") return Boolean(raw);
  const s = String(raw).trim();
  if (s === "") return optional ? null : undefined;
  switch (kind) {
    case "number": return Number(s);
    case "num-list": return s.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n));
    case "str-list": return s.split(",").map((x) => x.trim()).filter(Boolean);
    case "str-or-list": return s.includes(",") ? s.split(",").map((x) => x.trim()).filter(Boolean) : s;
    case "json": try { return JSON.parse(s); } catch { return s; }
    default: return s;
  }
}

/* -------------------------------------------------------------------- form */
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
        const { kind, optional } = resolve(prop);
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
                <option key={o} value={o}>{o}</option>
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
