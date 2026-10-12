import { describe, expect, it } from "vitest";
import { LabelRequest, MAX_ATTEMPTS, MAX_LABELS, placeLabels, uncoveredTicks } from "../src/view2d/placement";

const req = (key: string, ax: number, ay: number, extra: Partial<LabelRequest> = {}): LabelRequest => ({
  key,
  ax,
  ay,
  w: 60,
  h: 16,
  ...extra,
});

interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}
const overlap = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

describe("placeLabels", () => {
  it("puts a lone label north-east of its anchor", () => {
    expect(placeLabels([req("a", 100, 100)], 800, 600)).toEqual([{ key: "a", left: 106, top: 78 }]);
  });

  it("moves a label inside the pane near an edge", () => {
    const [placed] = placeLabels([req("a", 790, 5)], 800, 600);
    expect(placed.left + 60).toBeLessThanOrEqual(800);
    expect(placed.top).toBeGreaterThanOrEqual(0);
  });

  it("never overlaps two labels nor covers another anchor's dot", () => {
    const requests = Array.from({ length: 30 }, (_, i) => req(`p${i}`, 300 + (i % 6) * 25, 300 + Math.floor(i / 6) * 12));
    const placed = placeLabels(requests, 800, 600);
    expect(placed.length).toBeGreaterThan(5);
    const boxes = placed.map((p) => ({ l: p.left, t: p.top, r: p.left + 60, b: p.top + 16 }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
      for (const q of requests) expect(overlap(boxes[i], { l: q.ax - 5, t: q.ay - 5, r: q.ax + 5, b: q.ay + 5 })).toBe(false);
    }
  });

  it("drops a label with no free spot", () => {
    const placed = placeLabels([req("a", 30, 10), req("b", 30, 10)], 70, 30);
    expect(placed.map((p) => p.key)).toEqual([]);
    expect(placeLabels([req("a", 10, 28)], 100, 30).map((p) => p.key)).toEqual(["a"]);
  });

  it("places fixed labels first, exactly above their anchor", () => {
    const placed = placeLabels([req("dot", 100, 100), req("text", 100, 100, { fixed: true })], 800, 600);
    expect(placed[0]).toEqual({ key: "text", left: 100, top: 84 });
    expect(placed.map((p) => p.key)).toEqual(["text", "dot"]);
  });

  it("stops at the label cap", () => {
    const many = Array.from({ length: 2000 }, (_, i) => req(`p${i}`, (i % 100) * 1000, Math.floor(i / 100) * 1000, { w: 10, h: 10 }));
    expect(placeLabels(many, 1e6, 1e6)).toHaveLength(MAX_LABELS);
  });

  it("tries at most MAX_ATTEMPTS requests, however many are asked", () => {
    const unfit = Array.from({ length: MAX_ATTEMPTS }, (_, i) => req(`u${i}`, 500, 500, { w: 2e6 }));
    const fit = Array.from({ length: 4000 }, (_, i) => req(`f${i}`, (i % 100) * 1000 + 500, Math.floor(i / 100) * 1000 + 500, { w: 10, h: 10 }));
    expect(placeLabels([...unfit, ...fit], 1e6, 1e6)).toEqual([]);
  });

  it("caps 5000 requests at MAX_LABELS, all from the first MAX_ATTEMPTS", () => {
    const many = Array.from({ length: 5000 }, (_, i) => req(`p${i}`, (i % 100) * 1000 + 500, Math.floor(i / 100) * 1000 + 500, { w: 10, h: 10 }));
    const keys = placeLabels(many, 1e6, 1e6).map((p) => Number(p.key.slice(1)));
    expect(keys).toHaveLength(MAX_LABELS);
    expect(Math.max(...keys)).toBeLessThan(MAX_ATTEMPTS);
  });
});

describe("uncoveredTicks", () => {
  const tick = (key: string, left: number, top: number) => ({ key, left, top, w: 24, h: 15 });

  it("drops the tick labels an object label covers and keeps the rest", () => {
    const label = { left: 300, top: 290, w: 120, h: 18 }; // "P₁ (2.994, -0.123)" over the x axis ticks
    const ticks = [tick("3.0", 290, 300), tick("3.2", 350, 300), tick("3.4", 410, 300), tick("3.6", 470, 300), tick("1", 350, 100)];
    expect(uncoveredTicks(ticks, [label]).map((t) => t.key)).toEqual(["3.6", "1"]);
  });

  it("keeps a tick that only touches a label's edge", () => {
    expect(uncoveredTicks([tick("a", 100, 100)], [{ left: 124, top: 100, w: 50, h: 15 }])).toHaveLength(1);
    expect(uncoveredTicks([tick("a", 100, 100)], [])).toHaveLength(1);
  });
});
