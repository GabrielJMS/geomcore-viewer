import { describe, expect, it, vi } from "vitest";
import { HoverLink } from "../src/viewuv/link";

describe("HoverLink", () => {
  it("passes each hover to the listeners, and a clear only once", () => {
    const link = new HoverLink();
    const seen = vi.fn();
    link.onChange(seen);
    link.set({ surface: "Y", uv: [1, 2], from: "3d" });
    link.set(null);
    link.set(null);
    expect(seen.mock.calls.map((c) => c[0])).toEqual([{ surface: "Y", uv: [1, 2], from: "3d" }, null]);
    expect(link.current).toBeNull();
  });
});
