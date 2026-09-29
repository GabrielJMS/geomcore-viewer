import * as PIXI from "pixi.js";
import { Entity } from "./protocol";
import { Store } from "./store";

function cssToHex(css: string | undefined, fallback: number): number {
  if (!css) return fallback;
  const m = css.replace("#", "");
  const v = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  return Number.isNaN(v) ? fallback : v;
}

/**
 * PixiJS 2D pane (WebGL): parameter-space curves as stroked polylines,
 * point clouds as GPU particle batches — sized for millions of points,
 * unlike Canvas2D blitting.
 */
export class View2D {
  app: PIXI.Application;
  world = new PIXI.Container();
  nodes = new Map<string, PIXI.Container>();
  bounds = new PIXI.Rectangle(0, 0, 1, 1);
  private userMoved = false;

  constructor(private store: Store, private host: HTMLElement) {
    this.app = new PIXI.Application();
    (window as unknown as { __v2d?: View2D[] }).__v2d ??= [];
    (window as unknown as { __v2d: View2D[] }).__v2d.push(this);
    void this.app.init({ resizeTo: host, background: "#0b0e14", antialias: true }).then(() => {
      host.appendChild(this.app.canvas);
      this.app.stage.addChild(this.world);
      this.enableNav();
      store.onChange((kind, entity) => {
        if (kind === "clear" || kind === "reset") this.removeAll();
        if (kind === "reset") for (const e of store.entities.values()) this.show(e);
        if (kind === "upsert" && entity) this.show(entity);
        if (this.autoFit() && !this.userMoved) this.fit();
      });
      for (const e of this.store.entities.values()) this.show(e);
      this.fit();
    });
  }

  private autoFit(): boolean {
    return (document.getElementById("autofit") as HTMLInputElement | null)?.checked ?? true;
  }

  fitRequested(): void {
    this.userMoved = false;
    this.fit();
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
        const wx = (mx - this.world.x) / this.world.scale.x;
        const wy = (my - this.world.y) / this.world.scale.x;
        const s = Math.min(Math.max(this.world.scale.x * factor, 1e-6), 1e9);
        this.world.scale.set(s);
        this.world.x = mx - wx * s;
        this.world.y = my - wy * s;
      },
      { passive: false },
    );
  }

  private removeAll(): void {
    for (const n of this.nodes.values()) {
      this.world.removeChild(n);
      n.destroy({ children: true });
    }
    this.nodes.clear();
    this.bounds = new PIXI.Rectangle(0, 0, 1, 1);
  }

  private growBounds(x: number, y: number): void {
    if (this.bounds.width === 1 && this.bounds.height === 1 && this.bounds.x === 0 && this.bounds.y === 0) {
      this.bounds = new PIXI.Rectangle(x, y, 0, 0);
      return;
    }
    const b = this.bounds;
    const x0 = Math.min(b.x, x);
    const y0 = Math.min(b.y, y);
    const x1 = Math.max(b.x + b.width, x);
    const y1 = Math.max(b.y + b.height, y);
    this.bounds = new PIXI.Rectangle(x0, y0, Math.max(x1 - x0, 1e-9), Math.max(y1 - y0, 1e-9));
  }

  fit(): void {
    const b = this.bounds;
    if (b.width <= 0 || b.height <= 0) return;
    const w = this.host.clientWidth || 800;
    const h = this.host.clientHeight || 600;
    const pad = 40;
    const s = Math.min((w - pad) / b.width, (h - pad) / b.height);
    this.world.scale.set(s);
    // Y-upFlip: parameter space v grows upward.
    this.world.x = pad / 2 - b.x * s;
    this.world.y = h - pad / 2 + b.y * s + b.height * s;
    this.world.scale.y = -s;
  }

  show(e: Entity): void {
    const old = this.nodes.get(e.id);
    if (old) {
      this.world.removeChild(old);
      old.destroy({ children: true });
    }
    const node = new PIXI.Container();
    if (e.kind === "curve2d" && e.points && e.points.length >= 2) {
      const g = new PIXI.Graphics();
      g.moveTo(e.points[0][0], e.points[0][1]);
      for (const p of e.points.slice(1)) {
        g.lineTo(p[0], p[1]);
        this.growBounds(p[0], p[1]);
      }
      this.growBounds(e.points[0][0], e.points[0][1]);
      g.stroke({ width: 1.5 / Math.max(this.world.scale.x, 1e-9), color: cssToHex(e.color, 0xff5533) });
      node.addChild(g);
      this.nodes.set(e.id, node);
      this.world.addChild(node);
    } else if (e.kind === "points2d" && e.positions && e.positions.length > 0) {
      // One GPU-batched particle draw call regardless of point count.
      const container = new PIXI.ParticleContainer({ texture: PIXI.Texture.WHITE });
      const tint = cssToHex(e.color, 0x66ccff);
      const size = Math.max(e.size ?? 3, 1) / Math.max(this.world.scale.x, 1e-9);
      for (const p of e.positions) {
        container.addParticle(
          new PIXI.Particle({ texture: PIXI.Texture.WHITE, x: p[0], y: p[1], scaleX: size, scaleY: size, tint, anchorX: 0.5, anchorY: 0.5 }),
        );
        this.growBounds(p[0], p[1]);
      }
      node.addChild(container);
      this.nodes.set(e.id, node);
      this.world.addChild(node);
    }
    // 3D kinds belong to the Babylon pane — ignored here.
  }
}
