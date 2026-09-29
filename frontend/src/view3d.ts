import * as BABYLON from "@babylonjs/core";
import { Entity } from "./protocol";
import { Store } from "./store";

function cssToColor3(css: string | undefined, fallback: BABYLON.Color3): BABYLON.Color3 {
  if (!css) return fallback;
  try {
    return BABYLON.Color3.FromHexString(css.startsWith("#") ? css : `#${css}`);
  } catch {
    return fallback;
  }
}

/** Babylon.js 3D pane: curves as line systems, surfaces as meshes, clouds as points. */
export class View3D {
  scene: BABYLON.Scene;
  camera: BABYLON.ArcRotateCamera;
  meshes = new Map<string, BABYLON.AbstractMesh>();

  constructor(private store: Store, canvas: HTMLCanvasElement) {
    const engine = new BABYLON.Engine(canvas, true);
    this.scene = new BABYLON.Scene(engine);
    this.scene.clearColor = new BABYLON.Color4(0.96, 0.96, 0.97, 1);
    this.camera = new BABYLON.ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 3, 10, BABYLON.Vector3.Zero(), this.scene);
    this.camera.attachControl(canvas, true);
    new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0.3, 1, 0.5), this.scene);

    store.onChange((kind, entity) => {
      if (kind === "clear" || kind === "reset") this.removeAll();
      if (kind === "reset") for (const e of store.entities.values()) this.show(e);
      if (kind === "upsert" && entity) this.show(entity);
      if (this.autoFit()) this.fit();
    });
    window.addEventListener("resize", () => engine.resize());
    engine.runRenderLoop(() => this.scene.render());
  }

  private autoFit(): boolean {
    return (document.getElementById("autofit") as HTMLInputElement | null)?.checked ?? true;
  }

  fit(): void {
    const min = new BABYLON.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const max = new BABYLON.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
    let found = false;
    for (const e of this.store.entities.values()) {
      const pts = e.points ?? e.vertices ?? e.positions ?? [];
      for (const p of pts) {
        if (p.length < 3) continue;
        found = true;
        min.minimizeInPlace(new BABYLON.Vector3(p[0], p[1], p[2]));
        max.maximizeInPlace(new BABYLON.Vector3(p[0], p[1], p[2]));
      }
    }
    if (!found) return;
    const center = min.add(max).scale(0.5);
    const radius = Math.max(max.subtract(min).length() / 2, 1e-6);
    this.camera.target.copyFrom(center);
    this.camera.radius = radius * 3;
  }

  fitRequested(): void {
    this.fit();
  }

  private removeAll(): void {
    for (const m of this.meshes.values()) m.dispose();
    this.meshes.clear();
  }

  private replace(id: string, mesh: BABYLON.AbstractMesh): void {
    this.meshes.get(id)?.dispose();
    this.meshes.set(id, mesh);
  }

  show(e: Entity): void {
    if (e.kind === "curve3d" && e.points && e.points.length >= 2) {
      const line = BABYLON.MeshBuilder.CreateLineSystem(
        `e-${e.id}`,
        { lines: [e.points.map((p) => new BABYLON.Vector3(p[0], p[1], p[2]))] },
        this.scene,
      );
      line.color = cssToColor3(e.color, new BABYLON.Color3(1, 0.4, 0.2));
      this.replace(e.id, line);
    } else if (e.kind === "surface" && e.vertices && e.indices) {
      const data = new BABYLON.VertexData();
      data.positions = e.vertices.flat();
      data.indices = e.indices;
      data.normals = [];
      BABYLON.VertexData.ComputeNormals(data.positions, data.indices, data.normals);
      const mesh = new BABYLON.Mesh(`e-${e.id}`, this.scene);
      data.applyToMesh(mesh);
      const mat = new BABYLON.StandardMaterial(`m-${e.id}`, this.scene);
      mat.diffuseColor = cssToColor3(e.color, new BABYLON.Color3(0.3, 0.6, 1));
      mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
      mat.backFaceCulling = false;
      mesh.material = mat;
      this.replace(e.id, mesh);
    } else if (e.kind === "points3d" && e.positions && e.positions.length > 0) {
      const pcs = new BABYLON.PointsCloudSystem(`e-${e.id}`, e.size ?? 2, this.scene);
      pcs.addPoints(e.positions.length, (p: { position: BABYLON.Vector3; idx: number }) => {
        const q = e.positions![p.idx] as number[];
        p.position = new BABYLON.Vector3(q[0], q[1], q[2]);
      });
      const built = pcs.buildMeshAsync();
      void built.then((mesh) => {
        const mat = new BABYLON.StandardMaterial(`m-${e.id}`, this.scene);
        mat.diffuseColor = cssToColor3(e.color, new BABYLON.Color3(0.2, 0.2, 0.2));
        mat.emissiveColor = mat.diffuseColor;
        mesh.material = mat;
        this.replace(e.id, mesh);
      });
    }
    // curve2d / points2d belong to the 2D pane — ignored here.
  }
}
