import type { SceneObject } from "../protocol";
import type { Store } from "../store";

/** Numbers the runs seen since the page opened: the header shows "run 3" rather than a run id. */
export class RunCounter {
  private numbers = new Map<string, number>();

  /** The number of `run` (1 for the first one seen), 0 when there is no run. */
  observe(run: string | null): number {
    if (run === null) return 0;
    let n = this.numbers.get(run);
    if (n === undefined) {
      n = this.numbers.size + 1;
      this.numbers.set(run, n);
    }
    return n;
  }
}

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Objects as the header counts them: notes are messages, not objects. */
export function objectCount(objects: Iterable<SceneObject>): number {
  let n = 0;
  for (const o of objects) if (o.geom.type !== "note") n++;
  return n;
}

export interface HeaderModel {
  title: string;
  run: string;
  count: string;
}

export function headerModel(store: Store, runs: RunCounter): HeaderModel {
  const n = runs.observe(store.run);
  const rejected = store.problems.size ? ` · ${store.problems.size} rejected` : "";
  return {
    title: store.title || "geomcore-viewer",
    run: n ? `run ${n}` : "",
    count: plural(objectCount(store.objects.values()), "object") + rejected,
  };
}

export interface HeaderElements {
  title: HTMLElement;
  status: HTMLElement;
  run: HTMLElement;
  count: HTMLElement;
}

/** Status lines that report a failure (store.ts, view2d/view.ts, main.ts). */
const FAILURE = /fail|error|could not|unsupported|unavailable/i;

export const statusState = (status: string): "live" | "error" | "" =>
  status === "live" ? "live" : FAILURE.test(status) ? "error" : "";

export function renderHeader(store: Store, runs: RunCounter, els: HeaderElements): void {
  const m = headerModel(store, runs);
  els.title.textContent = m.title;
  document.title = store.title ? `${store.title} · geomcore-viewer` : "geomcore-viewer";
  els.status.textContent = store.status;
  els.status.dataset.state = statusState(store.status);
  els.run.textContent = m.run;
  els.count.textContent = m.count;
}
