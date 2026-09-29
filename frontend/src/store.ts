import { Entity, SceneDoc, isEntity } from "./protocol";

export type ChangeHandler = (kind: "upsert" | "clear" | "reset", entity?: Entity) => void;

/** In-memory scene + loading from server / URL / file / bundled sample. */
export class Store {
  entities = new Map<string, Entity>();
  handlers = new Set<ChangeHandler>();

  onChange(h: ChangeHandler): void {
    this.handlers.add(h);
  }

  private emit(kind: "upsert" | "clear" | "reset", entity?: Entity): void {
    for (const h of this.handlers) h(kind, entity);
  }

  upsert(e: Entity): void {
    this.entities.set(e.id, e);
    this.emit("upsert", e);
  }

  clear(remote = false): void {
    this.entities.clear();
    if (!remote) fetch("api/clear", { method: "POST" }).catch(() => {});
    this.emit("clear");
  }

  reset(doc: SceneDoc): void {
    this.entities.clear();
    for (const e of doc.entities) if (isEntity(e)) this.entities.set(e.id, e);
    this.emit("reset");
  }

  setStatus(text: string): void {
    const el = document.getElementById("status");
    if (el) el.textContent = text;
  }

  async load(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const sceneUrl = params.get("scene");
    if (sceneUrl) {
      this.setStatus(`loading ${sceneUrl}`);
      const res = await fetch(sceneUrl);
      this.reset((await res.json()) as SceneDoc);
      this.setStatus(`static: ${sceneUrl}`);
      return;
    }
    // Local server with SSE?
    try {
      const res = await fetch("api/scene");
      if (res.ok) {
        this.reset((await res.json()) as SceneDoc);
        this.setStatus("live · SSE");
        const events = new EventSource("events");
        events.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data) as { type: string; entity?: Entity; scene?: SceneDoc };
            if (data.type === "upsert" && data.entity && isEntity(data.entity)) {
              this.entities.set(data.entity.id, data.entity);
              this.emit("upsert", data.entity);
            } else if (data.type === "clear") {
              this.entities.clear();
              this.emit("clear");
            }
          } catch {
            /* ignore malformed events */
          }
        };
        events.onerror = () => this.setStatus("live · SSE reconnecting…");
        return;
      }
    } catch {
      /* no local server — fall through to bundled sample */
    }
    this.setStatus("static: sample-scene.json");
    const res = await fetch("sample-scene.json");
    this.reset((await res.json()) as SceneDoc);
  }
}
