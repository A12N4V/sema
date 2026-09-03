/** Pure helpers for rendering a Pydantic-v2 JSON schema as a form.
 *  Kept separate from the component so they're unit-testable. */

export interface PropSchema {
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

export type Kind = "number" | "string" | "bool" | "num-list" | "str-list" | "str-or-list" | "json";

export function resolveKind(p: PropSchema): { kind: Kind; optional: boolean } {
  if (p.anyOf && p.anyOf.length) {
    const optional = p.anyOf.some((x) => x.type === "null");
    const nn = p.anyOf.filter((x) => x.type !== "null");
    if (nn.length === 1) return { kind: resolveKind(nn[0]).kind, optional };
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

export const humanize = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function toInput(kind: Kind, v: unknown): string | boolean {
  if (kind === "bool") return Boolean(v);
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function fromInput(kind: Kind, raw: string | boolean, optional: boolean): unknown {
  if (kind === "bool") return Boolean(raw);
  const s = String(raw).trim();
  if (s === "") return optional ? null : undefined;
  switch (kind) {
    case "number":
      return Number(s);
    case "num-list":
      return s.split(",").map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n));
    case "str-list":
      return s.split(",").map((x) => x.trim()).filter(Boolean);
    case "str-or-list":
      return s.includes(",") ? s.split(",").map((x) => x.trim()).filter(Boolean) : s;
    case "json":
      try {
        return JSON.parse(s);
      } catch {
        return s;
      }
    default:
      return s;
  }
}
