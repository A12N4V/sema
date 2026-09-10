import { describe, expect, it } from "vitest";
import { parseRoute, sessionPath } from "./router";

describe("parseRoute", () => {
  it("root / connect", () => {
    expect(parseRoute("/")).toEqual({ name: "connect" });
    expect(parseRoute("/connect")).toEqual({ name: "connect" });
  });
  it("/s/:id defaults to the raw signal", () => {
    expect(parseRoute("/s/abc123")).toEqual({ name: "workspace", sessionId: "abc123", page: "signal" });
  });
  it("reads the container segment", () => {
    for (const page of ["signal", "ica", "source", "pipeline"] as const) {
      expect(parseRoute(`/s/abc/${page}`)).toEqual({ name: "workspace", sessionId: "abc", page });
    }
  });
  it("keeps old links working: v3's Analysis page is the Source container", () => {
    expect(parseRoute("/s/abc/analysis")).toEqual({ name: "workspace", sessionId: "abc", page: "source" });
    expect(parseRoute("/s/abc/raw")).toEqual({ name: "workspace", sessionId: "abc", page: "signal" });
  });
  it("decodes the id and falls back on an unknown container", () => {
    expect(parseRoute("/s/a%20b/whatever")).toEqual({ name: "workspace", sessionId: "a b", page: "signal" });
  });
  it("builds canonical paths", () => {
    expect(sessionPath("a b", "pipeline")).toBe("/s/a%20b/pipeline");
    expect(sessionPath("x")).toBe("/s/x/signal");
  });
});
