import "./style.css";
import { Store } from "./store";
import { View3D } from "./view3d";
import { View2D } from "./view2d";
import { Entity, isEntity } from "./protocol";

const store = new Store();
const canvas3d = document.getElementById("canvas3d") as HTMLCanvasElement;
const host2d = document.getElementById("view2d") as HTMLElement;
const view3d = new View3D(store, canvas3d);
void new View2D(store, host2d);

document.getElementById("fit")?.addEventListener("click", () => {
  view3d.fitRequested();
  for (const v of (window as unknown as { __v2d?: { fitRequested(): void }[] }).__v2d ?? []) v.fitRequested();
});
document.getElementById("clear")?.addEventListener("click", () => store.clear());

void store.load();

// Drag-and-drop a scene.json file anywhere on the page.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  void file.text().then((text) => {
    try {
      const doc = JSON.parse(text) as { entities?: unknown[] };
      const entities = (doc.entities ?? []).filter(isEntity) as Entity[];
      store.reset({ version: 1, entities });
      store.setStatus(`static: ${file.name}`);
    } catch {
      store.setStatus(`could not parse ${file.name}`);
    }
  });
});

void store.load();
