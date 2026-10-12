import "./style.css";
import { FrameScheduler } from "./frame";
import { Store } from "./store";
import { RunCounter, renderHeader } from "./ui/header";
import { mountKeys } from "./ui/keys";
import { mountPanel } from "./ui/panel";
import { UiState } from "./ui/state";
import { applyTheme } from "./ui/theme";
import { View2D } from "./view2d/view";
import { View3D } from "./view3d";

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from index.html`);
  return el as T;
}

const store = new Store();
const ui = new UiState();
applyTheme(ui.theme);

const toastEl = byId("toast");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** A short message over the view (copied coordinates, presentation mode hint). */
function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 2500);
}

// A machine without WebGL still gets the plane view and the panel.
let view3d: View3D | null = null;
try {
  view3d = new View3D(store, ui, byId<HTMLCanvasElement>("canvas3d"));
} catch (err) {
  console.error("geomcore-viewer: 3D view failed", err);
  store.setStatus(`3D view unavailable: ${err instanceof Error ? err.message : String(err)}`);
}
const view2d = new View2D(store, ui, byId("view2d"), toast);
mountPanel(store, ui, byId("object-list"));

const runs = new RunCounter();
const header = { title: byId("title"), status: byId("status"), run: byId("run"), count: byId("count") };
const stage = byId("stage");
const autofit = byId<HTMLInputElement>("autofit");
const shell = new FrameScheduler(() => {
  renderHeader(store, runs, header);
  const view = ui.activeView(store.view, store.objects.values());
  stage.dataset.view = view;
  byId("view-2d").setAttribute("aria-pressed", String(view === "2d"));
  byId("view-3d").setAttribute("aria-pressed", String(view === "3d"));
  byId("present").setAttribute("aria-pressed", String(ui.presenting));
  document.body.classList.toggle("presenting", ui.presenting);
  autofit.checked = ui.autoFit;
  view2d.setActive(view === "2d");
  view3d?.setActive(view === "3d");
});
store.onChange(() => shell.request());
ui.onChange((ev) => {
  if (ev === "theme") applyTheme(ui.theme);
  shell.request();
});
shell.request();

const fit = () => {
  view2d.fitRequested();
  view3d?.fitRequested();
};
const present = () => {
  ui.setPresenting(!ui.presenting);
  if (ui.presenting) toast("presentation mode · Esc to leave");
};
byId("fit").addEventListener("click", fit);
byId("view-2d").addEventListener("click", () => ui.setView("2d"));
byId("view-3d").addEventListener("click", () => ui.setView("3d"));
byId("theme").addEventListener("click", () => ui.toggleTheme());
byId("present").addEventListener("click", present);
autofit.addEventListener("change", () => ui.setAutoFit(autofit.checked)); // turning it on refits both views
byId("clear").addEventListener("click", () => void store.clearAll());
mountKeys({
  fit,
  present,
  theme: () => ui.toggleTheme(),
  view2d: () => ui.setView("2d"),
  view3d: () => ui.setView("3d"),
  escape: () => (ui.presenting ? ui.setPresenting(false) : ui.select(null)),
});

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

// Debug and e2e access (the e2e tests read cameras and strokes through it).
Object.assign(window, { __gv: { store, ui, view2d, view3d } });

void store.load();
