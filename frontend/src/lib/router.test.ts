import { describe, expect, it } from "vitest";
import { parseRoute } from "./router";

describe("parseRoute", () => {
  it("root / connect", () => {
    expect(parseRoute("/")).toEqual({ name: "connect" });
    expect(parseRoute("/connect")).toEqual({ name: "connect" });
  });
  it("/s/:id", () => {
    expect(parseRoute("/s/abc123")).toEqual({ name: "workspace", sessionId: "abc123" });
  });
  it("decodes the id and ignores trailing segments", () => {
    expect(parseRoute("/s/a%20b/whatever")).toEqual({ name: "workspace", sessionId: "a b" });
  });
});
