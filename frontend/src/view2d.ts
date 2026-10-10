import * as PIXI from "pixi.js";
import { sameBox, sceneBounds, viewBox } from "./geom/bounds";
import { inPlaneZ0 } from "./geom/planar";
import { arrowPolylines, tessellateCurve } from "./geom/tessellate";
import { Geom, isCurve } from "./geom/types";
import type { Box, Vec3 } from "./geom/vec";
import type { SceneObject } from "./protocol";
import type { Store, StoreEvent } from "./store";
import { colorOf } from "./ui/colors";

const hex = (css: string): number => {
  const m = css.replace("#", "");
  const v = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  return Number.isNaN(v) ? 0x30638e : v;
};

/** PixiJS pane for everything lying in z = 0, y up. Phase 2 replaces it with the full plane view. */
export class View2D {
  private app = new PIXI.Application();
  private world = new PIXI.Container();
  private nodes = new Map<string, PIXI.Container>();
  private box: Box = viewBox([]);
  private userMoved = false;
  private rebuildQueued = false;

  constructor(private store: Store, private host: HTMLElement) {
    void this.app.init({ resizeTo: host, background: "#f4f6fa", antialias: true }).then(() => {
      host.appendChild(this.app.canvas);
      this.app.stage.addChild(this.world);
      this.enableNav();
      store.onChange((ev) => this.onStore(ev));
      this.fit();
    }).catch((err: unknown) => {
      console.error("geomcore-viewer: 2D view failed", err);
      store.setStatus(`2D view failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private planarGeoms(): Geom[] {
    return [...this.store.objects.values()].map((o) => o.geom).filter(inPlaneZ0);
  }

  private onStore(ev: StoreEvent): void {
    if (ev.type === "meta") return;
    const box = viewBox(this.planarGeoms());
    const boxChanged = !sameBox(box, this.box);
    this.box = box;
    if (ev.type === "reset" || boxChanged) this.rebuild();
    else if (ev.type === "upsert") ev.objects.forEach((o) => this.show(o));
    else this.drop(ev.id);
    if (this.autoFit() && !this.userMoved) this.fit();
  }

  private autoFit(): boolean {
    return (document.getElementById("autofit") as HTMLInputElement | null)?.checked ?? true;
  }

  fitRequested(): void {
    this.userMoved = false;
    this.fit();
  }

  private fit(): void {
    const b = sceneBounds(this.planarGeoms());
    if (b) {
      const w = Math.max(b.max[0] - b.min[0], 1e-9);
      const h = Math.max(b.max[1] - b.min[1], 1e-9);
      const pad = 40;
      const width = this.host.clientWidth || 800;
      const height = this.host.clientHeight || 600;
      const s = Math.min((width - pad) / w, (height - pad) / h);
      this.world.scale.set(s, -s); // y up
      this.world.x = (width - w * s) / 2 - b.min[0] * s;
      this.world.y = (height + h * s) / 2 + b.min[1] * s;
    }
    this.rebuild(); // stroke widths are set in world units for the current zoom
  }

  private enableNav(): void {
    const canvas = this.app.canvas;
    let drag: { x: number; y: number } | null = null;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", (ev) => {
      drag = { x: ev.clientX, y: ev.clientY };
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      this.userMoved = true;
      this.world.x += ev.clientX - drag.x;
      this.world.y += ev.clientY - drag.y;
      drag = { x: ev.clientX, y: ev.clientY };
    });
    canvas.addEventListener("pointerup", () => (drag = null));
    canvas.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        this.userMoved = true;
        const factor = Math.exp(-ev.deltaY * 0.0015);
        const rect = canvas.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        const my = ev.clientY - rect.top;
        const sx = this.world.scale.x;
        const wx = (mx - this.world.x) / sx;
        const wy = (my - this.world.y) / -sx;
        const s = Math.min(Math.max(sx * factor, 1e-6), 1e9);
        this.world.scale.set(s, -s);
        this.world.x = mx - wx * s;
        this.world.y = my + wy * s;
        this.queueRebuild();
      },
      { passive: false },
    );
  }

  /** Stroke widths are in world units: refresh them once per frame while zooming. */
  private queueRebuild(): void {
    if (this.rebuildQueued) return;
    this.rebuildQueued = true;
    requestAnimationFrame(() => {
      this.rebuildQueued = false;
      this.rebuild();
    });
  }

  private rebuild(): void {
    this.box = viewBox(this.planarGeoms());
    for (const id of [...this.nodes.keys()]) this.drop(id);
    for (const o of this.store.objects.values()) this.show(o);
  }

  private drop(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    this.world.removeChild(node);
    node.destroy({ children: true });
    this.nodes.delete(id);
  }

  private show(o: SceneObject): void {
    this.drop(o.id);
    const g = o.geom;
    if (!inPlaneZ0(g)) return;
    const color = hex(colorOf(o));
    const px = 1 / Math.max(Math.abs(this.world.scale.x), 1e-9); // one screen pixel in world units
    const gfx = new PIXI.Graphics();
    const stroke = (polylines: Vec3[][]) => {
      const lines = polylines.filter((l) => l.length >= 2);
      if (!lines.length) return;
      for (const line of lines) {
        gfx.moveTo(line[0][0], line[0][1]);
        for (const p of line.slice(1)) gfx.lineTo(p[0], p[1]);
      }
      gfx.stroke({ width: 2 * px, color });
    };
    if (isCurve(g)) stroke([tessellateCurve(g, this.box)]);
    else if (g.type === "polyline") stroke([g.points]);
    else if (g.type === "arrow") stroke(arrowPolylines(g.at, g.vec));
    else if (g.type === "point") gfx.circle(g.p[0], g.p[1], 4 * px).fill(color);
    else if (g.type === "points") {
      for (const p of g.positions) gfx.circle(p[0], p[1], (g.size ?? 3) * px);
      gfx.fill(color);
    } else return;
    this.nodes.set(o.id, gfx);
    this.world.addChild(gfx);
  }
}
