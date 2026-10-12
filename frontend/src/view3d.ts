import * as BABYLON from "@babylonjs/core";
import { cameraScale } from "./camera";
import { Changes, FrameScheduler } from "./frame";
import { halfSize, sameBox, sceneBounds, viewBox } from "./geom/bounds";
import { arrowPolylines, tessellateCurve, tessellateSurface } from "./geom/tessellate";
import { isCurve, isSurface } from "./geom/types";
import type { Box, Vec3 } from "./geom/vec";
import type { SceneObject } from "./protocol";
import type { Store } from "./store";
import { colorOf } from "./ui/colors";
import type { UiEvent, UiState } from "./ui/state";
import { PALETTES } from "./ui/theme";

const v3 = (p: Vec3) => new BABYLON.Vector3(p[0], p[1], p[2]);

/** Babylon 3D pane, z up and right-handed like geomcore. Phase 2: coalesced updates, UiState, render loop only while shown. */
export class View3D {
  readonly scene: BABYLON.Scene;
  readonly camera: BABYLON.ArcRotateCamera;
  private engine: BABYLON.Engine;
  private meshes = new Map<string, BABYLON.AbstractMesh[]>();
  private box: Box = viewBox([]);
  private userMoved = false;
  private active = false;
  private changes = new Changes();
  private frame = new FrameScheduler(() => this.flush());

  constructor(
    private store: Store,
    private ui: UiState,
    canvas: HTMLCanvasElement,
  ) {
    this.engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.useRightHandedSystem = true;
    this.camera = new BABYLON.ArcRotateCamera("cam", Math.PI / 2, Math.PI / 3, 10, BABYLON.Vector3.Zero(), this.scene);
    this.camera.upVector = new BABYLON.Vector3(0, 0, 1);
    this.camera.attachControl(canvas, true);
    // Once the user has orbited, panned or zoomed, auto-fit leaves the camera alone until "fit".
    canvas.addEventListener("pointermove", (ev) => {
      if (ev.buttons) this.userMoved = true;
    });
    canvas.addEventListener("wheel", () => (this.userMoved = true), { passive: true });
    canvas.addEventListener("keydown", (ev) => {
      if (ev.key.startsWith("Arrow")) this.userMoved = true; // the camera's keyboard input
    });
    new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0.3, 0.5, 1), this.scene);
    this.applyTheme();
    store.onChange((ev) => {
      if (ev.type === "meta") return;
      this.changes.note(ev);
      this.frame.request();
    });
    ui.onChange((ev) => this.uiChanged(ev));
    new ResizeObserver(() => {
      if (!this.active) return;
      this.engine.resize();
      if (this.ui.autoFit && !this.userMoved) this.fit();
    }).observe(canvas);
    this.rebuild();
    this.fit();
  }

  /** Debug and e2e access: the camera's position. */
  get cameraState(): { alpha: number; beta: number; radius: number; target: Vec3 } {
    const t = this.camera.target;
    return { alpha: this.camera.alpha, beta: this.camera.beta, radius: this.camera.radius, target: [t.x, t.y, t.z] };
  }

  /** Render (and apply pending changes) only while the 3D view is the one shown. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (active) {
      this.engine.resize();
      this.engine.runRenderLoop(() => this.scene.render());
      this.frame.request();
    } else {
      this.engine.stopRenderLoop();
    }
  }

  private geoms() {
    return [...this.store.objects.values()].map((o) => o.geom);
  }

  /** Store changes folded since the last frame. While hidden they keep accumulating. */
  private flush(): void {
    if (!this.active) return;
    const { reset, ids } = this.changes.take();
    const box = viewBox(this.geoms());
    // Infinite curves and default surface windows depend on the box: rebuild when it moves.
    if (reset || !sameBox(box, this.box)) {
      this.rebuild();
    } else {
      for (const id of ids) {
        const o = this.store.objects.get(id);
        if (o) this.show(o);
        else this.drop(id);
      }
    }
    if (this.ui.autoFit && !this.userMoved) this.fit();
    else this.applyScale();
  }

  private uiChanged(ev: UiEvent): void {
    if (ev === "theme") this.applyTheme();
    else if (ev === "visibility") {
      for (const [id, meshes] of this.meshes) {
        const o = this.store.objects.get(id);
        const visible = o ? this.ui.isVisible(o) : false;
        meshes.forEach((m) => m.setEnabled(visible));
      }
    } else if (ev === "selection") this.frameSelected();
    else if (ev === "autofit" && this.ui.autoFit) this.fitRequested();
  }

  private applyTheme(): void {
    this.scene.clearColor = BABYLON.Color4.FromHexString(`${PALETTES[this.ui.theme].bg}ff`);
  }

  /** The "fit" button or key (or turning auto-fit on): frame the scene and follow it again. */
  fitRequested(): void {
    this.userMoved = false;
    this.fit();
  }

  /** Frame the selected object; one without extent (a point, an infinite curve's origin) is only re-targeted. */
  private frameSelected(): void {
    const o = this.ui.selected ? this.store.objects.get(this.ui.selected) : undefined;
    const b = o ? sceneBounds([o.geom]) : null;
    if (!b) return;
    this.camera.target.copyFrom(v3(b.min).add(v3(b.max)).scale(0.5));
    if (v3(b.max).subtract(v3(b.min)).length() > 0) this.camera.radius = this.fitRadius(b);
    this.userMoved = true;
  }

  /** Distance at which the camera frames the scene (the field of view is vertical, so a narrow pane backs off). */
  private fitRadius(b: Box): number {
    const aspect = this.engine.getAspectRatio(this.camera);
    return (Math.max(v3(b.max).subtract(v3(b.min)).length() / 2, 1e-6) * 3) / Math.min(1, aspect || 1);
  }

  /** Clip planes and zoom feel follow the scene's size, also when the camera is not moved. */
  private applyScale(): void {
    const b = sceneBounds(this.geoms());
    if (b) Object.assign(this.camera, cameraScale(this.fitRadius(b)));
  }

  private fit(): void {
    const b = sceneBounds(this.geoms());
    if (!b) return;
    this.camera.target.copyFrom(v3(b.min).add(v3(b.max)).scale(0.5));
    this.camera.radius = this.fitRadius(b);
    this.applyScale();
  }

  private rebuild(): void {
    this.box = viewBox(this.geoms());
    for (const id of [...this.meshes.keys()]) this.drop(id);
    for (const o of this.store.objects.values()) this.show(o);
  }

  private drop(id: string): void {
    this.meshes.get(id)?.forEach((m) => m.dispose(false, true));
    this.meshes.delete(id);
  }

  private show(o: SceneObject): void {
    this.drop(o.id);
    const made = this.build(o);
    if (!made.length) return;
    const visible = this.ui.isVisible(o);
    made.forEach((m) => m.setEnabled(visible));
    this.meshes.set(o.id, made);
  }

  private build(o: SceneObject): BABYLON.AbstractMesh[] {
    const g = o.geom;
    const color = BABYLON.Color3.FromHexString(colorOf(o));
    if (isCurve(g)) return this.lines(o.id, [tessellateCurve(g, this.box)], color);
    if (g.type === "polyline") return this.lines(o.id, [g.points], color);
    if (g.type === "arrow") return this.lines(o.id, arrowPolylines(g.at, g.vec), color);
    if (isSurface(g)) {
      const mesh = tessellateSurface(g, halfSize(this.box));
      return [this.surface(o, mesh.positions, mesh.indices, color)];
    }
    if (g.type === "mesh") return [this.surface(o, g.vertices.flat(), g.indices, color)];
    if (g.type === "point") return [this.marker(o.id, g.p, color)];
    if (g.type === "points") return g.positions.map((p, i) => this.marker(`${o.id}#${i}`, p, color, 0.5));
    return []; // text and notes: labels in 3D come with Phase 3
  }

  private lines(id: string, polylines: Vec3[][], color: BABYLON.Color3): BABYLON.AbstractMesh[] {
    const drawable = polylines.filter((l) => l.length >= 2);
    if (!drawable.length) return [];
    const mesh = BABYLON.MeshBuilder.CreateLineSystem(`o-${id}`, { lines: drawable.map((l) => l.map(v3)) }, this.scene);
    mesh.color = color;
    return [mesh];
  }

  private surface(o: SceneObject, positions: number[], indices: number[], color: BABYLON.Color3): BABYLON.Mesh {
    const data = new BABYLON.VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, data.normals);
    const mesh = new BABYLON.Mesh(`o-${o.id}`, this.scene);
    data.applyToMesh(mesh);
    const mat = new BABYLON.StandardMaterial(`m-${o.id}`, this.scene);
    mat.diffuseColor = color;
    mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    mat.backFaceCulling = false;
    mat.twoSidedLighting = true;
    mat.alpha = Math.min(Math.max(o.style?.opacity ?? 1, 0), 1);
    mesh.material = mat;
    return mesh;
  }

  private marker(id: string, p: Vec3, color: BABYLON.Color3, scale = 1): BABYLON.Mesh {
    const diameter = 0.02 * halfSize(this.box) * scale;
    const sphere = BABYLON.MeshBuilder.CreateSphere(`o-${id}`, { diameter, segments: 8 }, this.scene);
    sphere.position = v3(p);
    const mat = new BABYLON.StandardMaterial(`m-${id}`, this.scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.6);
    sphere.material = mat;
    return sphere;
  }
}
