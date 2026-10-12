import { describe, expect, it } from "vitest";
import { formatTick, gridSpacing, niceStep, ticks } from "../src/view2d/plane";

describe("niceStep and gridSpacing", () => {
  it("rounds up to 1, 2 or 5 times a power of ten", () => {
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.3)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.0031)).toBeCloseTo(0.005, 15);
    expect(niceStep(2e7)).toBe(2e7);
  });

  it("puts major lines 60 to 150 px apart with matching minor lines", () => {
    expect(gridSpacing(100)).toEqual({ major: 1, minor: 0.2 });
    expect(gridSpacing(40)).toEqual({ major: 2, minor: 0.5 });
    expect(gridSpacing(25)).toEqual({ major: 5, minor: 1 });
  });
});

describe("ticks", () => {
  it("lists the multiples of the step in range", () => {
    expect(ticks(-1.2, 2.5, 1)).toEqual([-1, 0, 1, 2]);
    expect(ticks(0.1, 0.9, 1)).toEqual([]);
  });

  it("gives up rather than produce thousands of lines", () => {
    expect(ticks(0, 1e6, 1)).toEqual([]);
    expect(ticks(0, 1999, 1)).toHaveLength(2000);
  });
});

describe("formatTick", () => {
  it("shows as many decimals as the step needs", () => {
    expect(formatTick(2, 1)).toBe("2");
    expect(formatTick(-1.5, 0.5)).toBe("-1.5");
    expect(formatTick(0.30000000000000004, 0.1)).toBe("0.3");
    expect(formatTick(0.025, 0.005)).toBe("0.025");
    expect(formatTick(400, 200)).toBe("400");
  });

  it("writes 0 for the origin even after rounding noise", () => {
    expect(formatTick(1e-17, 0.1)).toBe("0");
    expect(formatTick(-0, 1)).toBe("0");
  });

  it("formats very large and very small steps", () => {
    expect(formatTick(3e6, 1e6)).toBe("3e6");
    expect(formatTick(-2e9, 1e9)).toBe("-2e9");
    expect(formatTick(2.5e-5, 5e-6)).toBe("2.5e-5");
    expect(formatTick(3 * 1e-7, 1e-7)).toBe("3e-7");
    const { major } = gridSpacing(1e-6);
    expect(Number.isFinite(major)).toBe(true);
    expect(formatTick(7 * major, major)).toBe("7e8");
  });
});

describe("ticks at extreme offsets", () => {
  it("gives up instead of looping when indices pass the safe integers", () => {
    expect(ticks(1e6 - 4e-10, 1e6 + 4e-10, 1e-10)).toEqual([]);
  });
});
