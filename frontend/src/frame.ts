import type { StoreEvent } from "./store";

type Raf = (callback: () => void) => unknown;

/** Runs `work` once on the next animation frame, however many times `request()` is called before it. */
export class FrameScheduler {
  private queued = false;

  constructor(
    private work: () => void,
    private raf: Raf = (callback) => requestAnimationFrame(callback),
  ) {}

  request(): void {
    if (this.queued) return;
    this.queued = true;
    this.raf(() => {
      this.queued = false; // before the work: a throwing frame must not wedge the scheduler
      this.work();
    });
  }
}

/** Store events folded between two frames: a reset swallows every id before and after it. */
export class Changes {
  reset = false;
  readonly ids = new Set<string>();

  note(ev: StoreEvent): void {
    if (ev.type === "reset") {
      this.reset = true;
      this.ids.clear();
    } else if (this.reset || ev.type === "meta") {
      return;
    } else if (ev.type === "upsert") {
      for (const o of ev.objects) this.ids.add(o.id);
    } else {
      this.ids.add(ev.id);
    }
  }

  get empty(): boolean {
    return !this.reset && this.ids.size === 0;
  }

  take(): { reset: boolean; ids: string[] } {
    const out = { reset: this.reset, ids: [...this.ids] };
    this.reset = false;
    this.ids.clear();
    return out;
  }
}
