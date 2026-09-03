import { describe, expect, it } from "vitest";
import { fromInput, humanize, resolveKind, toInput } from "./schemaForm";

describe("resolveKind", () => {
  it("number and integer both → number", () => {
    expect(resolveKind({ type: "number" })).toEqual({ kind: "number", optional: false });
    expect(resolveKind({ type: "integer" })).toEqual({ kind: "number", optional: false });
  });
  it("X | null → optional X", () => {
    expect(resolveKind({ anyOf: [{ type: "number" }, { type: "null" }] })).toEqual({
      kind: "number",
      optional: true,
    });
  });
  it("int | number union → number", () => {
    expect(resolveKind({ anyOf: [{ type: "integer" }, { type: "number" }] }).kind).toBe("number");
  });
  it("string | array<string> → str-or-list", () => {
    expect(
      resolveKind({ anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] }).kind,
    ).toBe("str-or-list");
  });
  it("array of number vs string", () => {
    expect(resolveKind({ type: "array", items: { type: "number" } }).kind).toBe("num-list");
    expect(resolveKind({ type: "array", items: { type: "string" } }).kind).toBe("str-list");
  });
  it("enum → string", () => {
    expect(resolveKind({ type: "string", enum: ["a", "b"] }).kind).toBe("string");
  });
});

describe("fromInput", () => {
  it("coerces numbers", () => {
    expect(fromInput("number", "1.5", false)).toBe(1.5);
  });
  it("blank optional → null, blank required → undefined", () => {
    expect(fromInput("number", "", true)).toBeNull();
    expect(fromInput("number", "", false)).toBeUndefined();
  });
  it("num-list parses and drops junk", () => {
    expect(fromInput("num-list", "50, 100, x", false)).toEqual([50, 100]);
  });
  it("str-or-list: comma → list, else string", () => {
    expect(fromInput("str-or-list", "average", false)).toBe("average");
    expect(fromInput("str-or-list", "M1, M2", false)).toEqual(["M1", "M2"]);
  });
  it("bool", () => {
    expect(fromInput("bool", true, false)).toBe(true);
  });
});

describe("toInput", () => {
  it("array → comma string, null → empty", () => {
    expect(toInput("num-list", [60])).toBe("60");
    expect(toInput("number", undefined)).toBe("");
  });
});

describe("humanize", () => {
  it("snake_case → Title Case", () => {
    expect(humanize("l_freq")).toBe("L Freq");
    expect(humanize("n_components")).toBe("N Components");
  });
});
