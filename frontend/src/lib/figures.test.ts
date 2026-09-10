/**
 * The client half of the precomputed-figure contract.
 *
 * The failure mode this guards is silent: if the key the client builds stops
 * matching the key the server cached under, everything still *works*, it just
 * re-renders every figure on every scrub, and nobody notices until the app
 * feels slow again. So: pin the key, pin the grid lookup.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { figure, figureKey, nearestFrame, peek, prefetch, setGeneration } from "./figures";
import { api } from "../api/client";

let served = 0;
vi.mock("../api/client", () => ({
  api: { render: vi.fn(async () => `blob:${Math.random()}`) },
}));

beforeEach(() => {
  served = 0;
  vi.mocked(api.render).mockClear();
  vi.mocked(api.render).mockImplementation(async () => `blob:${served++}`);
  // jsdom has no object URLs
  vi.stubGlobal("URL", { revokeObjectURL: () => {}, createObjectURL: () => "blob:x" });
  setGeneration("");
  setGeneration("gen-1");
});

describe("figureKey", () => {
  it("does not depend on the order the spec was written in", () => {
    expect(figureKey({ view: "topomap", t: 1.2, width: 280 }))
      .toBe(figureKey({ width: 280, view: "topomap", t: 1.2 }));
  });

  it("separates specs that must not share a figure", () => {
    const base = { view: "topomap", source: "cursor", t: 1.2, width: 280, height: 280 };
    expect(figureKey({ ...base, theme: "dark" })).not.toBe(figureKey({ ...base, theme: "light" }));
    expect(figureKey({ ...base, t: 1.2 })).not.toBe(figureKey({ ...base, t: 1.3 }));
    expect(figureKey({ ...base, width: 280 })).not.toBe(figureKey({ ...base, width: 360 }));
  });
});

describe("nearestFrame", () => {
  const grid = [0, 1, 2, 3, 4];

  it("returns the closest grid time", () => {
    expect(nearestFrame(grid, 2.2)).toBe(2);
    expect(nearestFrame(grid, 2.6)).toBe(3);
  });

  it("clamps to the ends rather than running off the grid", () => {
    expect(nearestFrame(grid, -10)).toBe(0);
    expect(nearestFrame(grid, 99)).toBe(4);
  });

  it("hits exactly when the cursor is already on the grid", () => {
    for (const t of grid) expect(nearestFrame(grid, t)).toBe(t);
  });

  it("passes the time through when there is no grid yet", () => {
    expect(nearestFrame([], 7.5)).toBe(7.5);
  });
});

describe("the figure cache", () => {
  const spec = { view: "sensors", theme: "dark" };

  it("serves a second request for the same figure from memory", async () => {
    const first = await figure("s1", spec);
    expect(peek(spec)).toBe(first);
    expect(await figure("s1", spec)).toBe(first);
    expect(api.render).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent requests for one figure into a single render", async () => {
    const [a, b, c] = await Promise.all([figure("s1", spec), figure("s1", spec), figure("s1", spec)]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(api.render).toHaveBeenCalledTimes(1);
  });

  it("drops everything when the signal moves: a stale figure is the wrong data", async () => {
    await figure("s1", spec);
    expect(peek(spec)).toBeDefined();
    setGeneration("gen-2");
    expect(peek(spec)).toBeUndefined();
  });

  it("keeps the cache when the generation is re-asserted unchanged", async () => {
    const url = await figure("s1", spec);
    setGeneration("gen-1");
    expect(peek(spec)).toBe(url);
  });
});

describe("prefetch", () => {
  it("loads every frame and reports monotonic progress", async () => {
    const specs = [0, 1, 2, 3, 4, 5, 6].map((t) => ({ view: "topomap", t }));
    const seen: number[] = [];
    await prefetch("s1", specs, (f) => seen.push(f));
    expect(api.render).toHaveBeenCalledTimes(specs.length);
    expect(specs.every((s) => peek(s))).toBe(true);
    expect(seen).toHaveLength(specs.length);
    expect(seen[seen.length - 1]).toBeCloseTo(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it("one unrenderable frame does not abandon the rest", async () => {
    vi.mocked(api.render).mockImplementation(async (_id, spec) => {
      if ((spec as { t: number }).t === 1) throw new Error("no montage");
      return `blob:${served++}`;
    });
    const specs = [0, 1, 2].map((t) => ({ view: "topomap", t }));
    await prefetch("s1", specs);
    expect(peek(specs[0])).toBeDefined();
    expect(peek(specs[1])).toBeUndefined();
    expect(peek(specs[2])).toBeDefined();
  });
});
