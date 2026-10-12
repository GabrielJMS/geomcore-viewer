export const FONT_FAMILY = "system-ui, sans-serif";

/** One DOM label: `key` keeps the same element across frames. */
export interface LabelItem {
  key: string;
  text: string;
  left: number;
  top: number;
  className: string;
  fontPx: number;
  color?: string;
}

/**
 * Text drawn as DOM elements over a canvas (spec §5.2: crisp at any zoom, selectable).
 * Elements are reused by key, so a redraw only moves them.
 */
export class LabelLayer {
  readonly root: HTMLDivElement;
  private nodes = new Map<string, HTMLDivElement>();

  constructor(host: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "labels";
    host.appendChild(this.root);
  }

  render(items: LabelItem[]): void {
    const keep = new Set<string>();
    for (const item of items) {
      keep.add(item.key);
      let node = this.nodes.get(item.key);
      if (!node) {
        node = document.createElement("div");
        this.nodes.set(item.key, node);
        this.root.appendChild(node);
      }
      if (node.textContent !== item.text) node.textContent = item.text;
      if (node.className !== item.className) node.className = item.className;
      node.style.fontSize = `${item.fontPx}px`;
      node.style.color = item.color ?? "";
      node.style.transform = `translate(${Math.round(item.left)}px, ${Math.round(item.top)}px)`;
    }
    for (const [key, node] of this.nodes) {
      if (keep.has(key)) continue;
      node.remove();
      this.nodes.delete(key);
    }
  }
}

/** Text widths for label placement, measured once per (text, size, weight) with a canvas. */
export class TextMeasure {
  private ctx: CanvasRenderingContext2D | null = document.createElement("canvas").getContext("2d");
  private cache = new Map<string, number>();

  width(text: string, fontPx: number, weight = 400): number {
    const key = `${weight}|${fontPx}|${text}`;
    let w = this.cache.get(key);
    if (w === undefined) {
      if (this.ctx) {
        this.ctx.font = `${weight} ${fontPx}px ${FONT_FAMILY}`;
        w = this.ctx.measureText(text).width;
      } else {
        w = 0.6 * fontPx * text.length;
      }
      if (this.cache.size > 5000) this.cache.clear();
      this.cache.set(key, w);
    }
    return w;
  }
}
