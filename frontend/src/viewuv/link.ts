import type { Vec2 } from "../geom/vec";

/** Where the pointer is in a surface's parameters, and which pane put it there. */
export interface UvHover {
  surface: string;
  uv: Vec2;
  from: "3d" | "uv";
}

/**
 * Spec §5.4: hover in either pane shows the corresponding point in the other. The 3D view
 * publishes (u, v) when the pointer is on a surface or a pcurve, the (u,v) pane when it is
 * inside the window; each draws a marker for what the other published.
 */
export class HoverLink {
  current: UvHover | null = null;
  private handlers = new Set<(h: UvHover | null) => void>();

  onChange(handler: (h: UvHover | null) => void): void {
    this.handlers.add(handler);
  }

  set(h: UvHover | null): void {
    if (h === null && this.current === null) return;
    this.current = h;
    for (const handler of this.handlers) handler(h);
  }
}
