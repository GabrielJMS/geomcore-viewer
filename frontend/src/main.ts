import "./style.css";
import { Store } from "./store";
import { mountPanel } from "./ui/panel";
import { UiState } from "./ui/state";
import { View2D } from "./view2d/view";
import { View3D } from "./view3d";

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from index.html`);
  return el as T;
}

const store = new Store();
const ui = new UiState();
const view3d = new View3D(store, ui, byId<HTMLCanvasElement>("canvas3d"));
view3d.setActive(true);
const view2d = new View2D(store, ui, byId("view2d"), (message) => store.setStatus(message));
view2d.setActive(true);
mountPanel(store, byId("entity-list"), byId("title"), byId("status"));

byId("fit").addEventListener("click", () => {
  view3d.fitRequested();
  view2d.fitRequested();
});
byId<HTMLInputElement>("autofit").addEventListener("change", (e) => {
  ui.setAutoFit((e.target as HTMLInputElement).checked); // turning it on refits both views
});
byId("clear").addEventListener("click", () => void store.clearAll());

// Drag-and-drop a scene .json file anywhere on the page.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  void file.text().then((text) => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      store.setStatus(`could not parse ${file.name}`);
      return;
    }
    if (store.loadJson(raw, file.name)) store.setStatus(`static: ${file.name}`);
  });
});

void store.load();
