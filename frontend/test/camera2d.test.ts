import { describe, expect, it } from "vitest";
import {
  Camera2D,
  MAX_SCALE,
  MIN_SCALE,
  fitCamera,
  panBy,
  resizeCamera,
  screenToWorld,
  shouldRefit,
  visibleRect,
  worldToScreen,
  zoomAt,
} from "../src/view2d/camera";

const cam: Camera2D = { cx: 1, cy: 2, scale: 50, width: 800, height: 600 };
const finite = (c: Camera2D) => [c.cx, c.cy, c.scale].every(Number.isFinite) && c.scale > 0;

describe("Camera2D transforms", () => {
  it("maps the center to the middle of the pane, y up", () => {
    expect(worldToScreen(cam, 1, 2)).toEqual([400, 300]);
    expect(worldToScreen(cam, 2, 3)).toEqual([450, 250]);
    expect(screenToWorld(cam, 450, 250)).toEqual([2, 3]);
  });

  it("reports the visible world rectangle", () => {
    expect(visibleRect(cam)).toEqual({ xmin: -7, xmax: 9, ymin: -4, ymax: 8 });
  });
});

describe("fitCamera", () => {
  it("frames a box with padding, keeping the aspect ratio 1:1", () => {
    const c = fitCamera({ min: [0, 0, 0], max: [10, 2, 0] }, 840, 600);
    expect(c).toEqual({ cx: 5, cy: 1, scale: 76, width: 840, height: 600 });
  });

  it("frames a vertical segment and a single point", () => {
    expect(fitCamera({ min: [3, 0, 0], max: [3, 4, 0] }, 800, 600).scale).toBe(130);
    const point = fitCamera({ min: [3, 4, 0], max: [3, 4, 0] }, 800, 600);
    expect([point.cx, point.cy, point.scale]).toEqual([3, 4, 260]);
  });

  it("shows ±5 around the origin for an empty scene", () => {
    const c = fitCamera(null, 800, 600);
    expect(visibleRect(c).ymin).toBeCloseTo(-5.77, 2);
    expect([c.cx, c.cy]).toEqual([0, 0]);
  });

  it("stays finite for a hidden pane", () => {
    const box = { min: [-1, -1, 0], max: [4, 2, 0] } as const;
    for (const [w, h] of [[0, 0], [0, 600], [1, 1]]) {
      const c = fitCamera({ min: [...box.min], max: [...box.max] }, w, h);
      expect(finite(c)).toBe(true);
      expect(finite(resizeCamera(c, 800, 600))).toBe(true);
      expect(worldToScreen(resizeCamera(c, 800, 600), 0, 0).every(Number.isFinite)).toBe(true);
    }
    expect(finite(fitCamera(null, 0, 0))).toBe(true);
  });

  it("clamps the zoom for huge and tiny scenes", () => {
    expect(fitCamera({ min: [0, 0, 0], max: [1e-15, 1e-15, 0] }, 800, 600).scale).toBe(MAX_SCALE);
    expect(fitCamera({ min: [0, 0, 0], max: [1e15, 1e15, 0] }, 800, 600).scale).toBe(MIN_SCALE);
  });
});

describe("zoomAt and panBy", () => {
  it("keeps the world point under the cursor while zooming", () => {
    const before = screenToWorld(cam, 100, 500);
    const zoomed = zoomAt(cam, 100, 500, 3);
    expect(zoomed.scale).toBe(150);
    const after = screenToWorld(zoomed, 100, 500);
    expect(after[0]).toBeCloseTo(before[0], 12);
    expect(after[1]).toBeCloseTo(before[1], 12);
  });

  it("stops at the zoom limits", () => {
    expect(zoomAt(cam, 0, 0, 1e30).scale).toBe(MAX_SCALE);
    expect(zoomAt(cam, 0, 0, 1e-30).scale).toBe(MIN_SCALE);
  });

  it("drags the world with the pointer", () => {
    const moved = panBy(cam, 50, -100);
    expect(worldToScreen(moved, 1, 2)).toEqual([450, 200]);
  });
});

describe("shouldRefit", () => {
  const still = { fitRequested: false, autoFit: true, userMoved: false, sceneChanged: false, resized: false };

  it("honours a fit request even with auto-fit off and a moved camera", () => {
    expect(shouldRefit({ ...still, fitRequested: true, autoFit: false, userMoved: true })).toBe(true);
  });

  it("follows the scene and the pane size while auto-fit is on and the camera untouched", () => {
    expect(shouldRefit({ ...still, sceneChanged: true })).toBe(true);
    expect(shouldRefit({ ...still, resized: true })).toBe(true);
    expect(shouldRefit(still)).toBe(false);
  });

  it("leaves the camera alone once the user moved it or auto-fit is off", () => {
    expect(shouldRefit({ ...still, sceneChanged: true, userMoved: true })).toBe(false);
    expect(shouldRefit({ ...still, sceneChanged: true, resized: true, autoFit: false })).toBe(false);
  });
});
