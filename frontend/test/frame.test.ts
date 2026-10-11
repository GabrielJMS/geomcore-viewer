import { describe, expect, it, vi } from "vitest";
import { Changes, FrameScheduler } from "../src/frame";
import type { SceneObject } from "../src/protocol";

function manualFrames() {
  const queue: (() => void)[] = [];
  return {
    raf: (cb: () => void) => queue.push(cb),
    flush: () => queue.splice(0).forEach((cb) => cb()),
    size: () => queue.length,
  };
}

const pt = (id: string) => ({ id, geom: { type: "point", p: [0, 0, 0] } }) as SceneObject;

describe("FrameScheduler", () => {
  it("runs the work once per frame however often it is requested", () => {
    const frames = manualFrames();
    const work = vi.fn();
    const scheduler = new FrameScheduler(work, frames.raf);
    for (let i = 0; i < 300; i++) scheduler.request();
    expect(frames.size()).toBe(1);
    frames.flush();
    expect(work).toHaveBeenCalledTimes(1);
    scheduler.request();
    frames.flush();
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("keeps scheduling after a frame whose work threw", () => {
    const frames = manualFrames();
    const scheduler = new FrameScheduler(() => {
      throw new Error("boom");
    }, frames.raf);
    scheduler.request();
    expect(() => frames.flush()).toThrow("boom");
    scheduler.request();
    expect(frames.size()).toBe(1);
  });
});

describe("Changes", () => {
  it("collects upserted and removed ids until taken", () => {
    const changes = new Changes();
    changes.note({ type: "upsert", objects: [pt("a"), pt("b")] });
    changes.note({ type: "remove", id: "c" });
    changes.note({ type: "meta" });
    expect(changes.empty).toBe(false);
    expect(changes.take()).toEqual({ reset: false, ids: ["a", "b", "c"] });
    expect(changes.empty).toBe(true);
  });

  it("lets a reset swallow the ids before and after it", () => {
    const changes = new Changes();
    changes.note({ type: "upsert", objects: [pt("a")] });
    changes.note({ type: "reset" });
    changes.note({ type: "upsert", objects: [pt("b")] });
    expect(changes.take()).toEqual({ reset: true, ids: [] });
  });
});
