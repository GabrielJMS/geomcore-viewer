import * as BABYLON from "@babylonjs/core";
import { halfSize, sameBox, sceneBounds, viewBox } from "./geom/bounds";
import { arrowPolylines, tessellateCurve, tessellateSurface } from "./geom/tessellate";
import { isCurve, isSurface } from "./geom/types";
import type { Box, Vec3 } from "./geom/vec";
import type { SceneObject } from "./protocol";
import type { Store, StoreEvent } from "./store";
import { colorOf } from "./ui/colors";

const v3 = (p: Vec3) => new BABYLON.Vector3(p[0], p[1], p[2]);

function color3(css: string): BABYLON.Color3 {
  try {
    return BABYLON.Color3.FromHexString(css.startsWith("#") ? css : `#${css}`);
  } catch {
    return BABYLON.Color3.FromHexString("#30638e");
  }
}

/** Babylon 3D pane, z up and right-handed like geomcore. Phase 1: thin lines, plain markers. */
export class View3D {
  readonly scene: BABYLON.Scene;
  readonly camera: BABYLON.ArcRotateCamera;
  private meshes = new Map<string, BABYLON.AbstractMesh[]>();
  private box: Box = viewBox([]);

  constructor(private store: Store, canvas: HTMLCanvasElement) {
    const engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(engine);
    this.scene.useRightHandedSystem = true;
    this.scene.clearColor = new BABYLON.Color4(0.96, 0.96, 0.97, 1);
    this.camera = new BABYLON.ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 3, 10, BABYLON.Vector3.Zero(), this.scene);
    this.camera.upVector = new BABYLON.Vector3(0, 0, 1);
    this.camera.attachControl(canvas, true);
    new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0.3, 0.5, 1), this.scene);
    store.onChange((ev) => this.onStore(ev));
    window.addEventListener("resize", () => engine.resize());
    engine.runRenderLoop(() => this.scene.render());
    this.rebuild();
    this.fit();
  }

  private geoms() {
    return [...this.store.objects.values()].map((o) => o.geom);
  }

  private onStore(ev: StoreEvent): void {
    if (ev.type === "meta") return;
    const box = viewBox(this.geoms());
    const boxChanged = !sameBox(box, this.box);
    this.box = box;
    // Infinite curves and default surface windows depend on the box: rebuild when it moves.
    if (ev.type === "reset" || boxChanged) this.rebuild();
    else if (ev.type === "upsert") ev.objects.forEach((o) => this.show(o));
    else this.drop(ev.id);
    if (this.autoFit()) this.fit();
  }

  private autoFit(): boolean {
    return (document.getElementById("autofit") as HTMLInputElement | null)?.checked ?? true;
  }

  fit(): void {
    const b = sceneBounds(this.geoms());
    if (!b) return;
    const center = v3(b.min).add(v3(b.max)).scale(0.5);
    this.camera.target.copyFrom(center);
    this.camera.radius = Math.max(v3(b.max).subtract(v3(b.min)).length() / 2, 1e-6) * 3;
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
    if (made.length) this.meshes.set(o.id, made);
  }

  private build(o: SceneObject): BABYLON.AbstractMesh[] {
    const g = o.geom;
    const color = color3(colorOf(o));
    if (isCurve(g)) return [this.lines(o.id, [tessellateCurve(g, this.box)], color)];
    if (g.type === "polyline") return [this.lines(o.id, [g.points], color)];
    if (g.type === "arrow") return [this.lines(o.id, arrowPolylines(g.at, g.vec), color)];
    if (isSurface(g)) {
      const mesh = tessellateSurface(g, halfSize(this.box));
      return [this.surface(o, mesh.positions, mesh.indices, color)];
    }
    if (g.type === "mesh") return [this.surface(o, g.vertices.flat(), g.indices, color)];
    if (g.type === "point") return [this.marker(o.id, g.p, color)];
    if (g.type === "points") return g.positions.map((p, i) => this.marker(`${o.id}#${i}`, p, color, 0.5));
    return []; // text and notes: panel only in Phase 1
  }

  private lines(id: string, polylines: Vec3[][], color: BABYLON.Color3): BABYLON.LinesMesh {
    const mesh = BABYLON.MeshBuilder.CreateLineSystem(`o-${id}`, { lines: polylines.map((l) => l.map(v3)) }, this.scene);
    mesh.color = color;
    return mesh;
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
