import type { Store } from "../store";
import { colorOf } from "./colors";

function row(className: string, text: string): HTMLLIElement {
  const li = document.createElement("li");
  li.className = className;
  li.textContent = text;
  return li;
}

/** Side panel: one row per object (swatch, label, type), notes, and rejected objects. */
export function mountPanel(store: Store, list: HTMLElement, title: HTMLElement, status: HTMLElement): void {
  const render = () => {
    title.textContent = store.title || "geomcore-viewer";
    document.title = store.title ? `${store.title} · geomcore-viewer` : "geomcore-viewer";
    status.textContent = store.status;
    const rows: HTMLLIElement[] = [];
    for (const o of store.objects.values()) {
      if (o.geom.type === "note") {
        const warn = o.geom.level === "warn";
        rows.push(row(`note ${warn ? "warn" : "info"}`, `${warn ? "⚠" : "ⓘ"} ${o.geom.text}`));
        continue;
      }
      const li = row("object", "");
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = colorOf(o);
      const name = document.createElement("span");
      name.textContent = o.label ?? o.id;
      const type = document.createElement("span");
      type.className = "type";
      type.textContent = o.source ?? o.geom.type;
      li.append(swatch, name, type);
      rows.push(li);
    }
    for (const p of store.problems.values()) rows.push(row("problem", `⚠ ${p.id}: ${p.message}`));
    list.replaceChildren(...rows);
  };
  store.onChange(render);
  render();
}
