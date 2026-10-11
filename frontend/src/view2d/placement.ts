/** A label to place: anchored at screen (ax, ay), `w` × `h` pixels. `fixed` labels sit just above their anchor. */
export interface LabelRequest {
  key: string;
  ax: number;
  ay: number;
  w: number;
  h: number;
  fixed?: boolean;
}

export interface PlacedLabel {
  key: string;
  left: number;
  top: number;
}

interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

const GAP = 6;
const DOT = 5;
export const MAX_LABELS = 500;

/** Candidate top-left corners around the anchor, in order of preference: NE, E, SE, NW, W, SW, N, S. */
function candidates(q: LabelRequest): [number, number][] {
  const { ax, ay, w, h } = q;
  return [
    [ax + GAP, ay - GAP - h],
    [ax + GAP, ay - h / 2],
    [ax + GAP, ay + GAP],
    [ax - GAP - w, ay - GAP - h],
    [ax - GAP - w, ay - h / 2],
    [ax - GAP - w, ay + GAP],
    [ax - w / 2, ay - GAP - h],
    [ax - w / 2, ay + GAP],
  ];
}

const overlaps = (a: Box, b: Box): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

/**
 * Greedy placement (spec §5.2): requests in order, each at the first candidate that stays
 * inside the `width` × `height` pane and overlaps neither a placed label nor any anchor's
 * dot. Fixed labels (plain text objects) go first, where they were asked. A label with no
 * free spot is left out; at most `MAX_LABELS` are placed.
 */
export function placeLabels(requests: LabelRequest[], width: number, height: number): PlacedLabel[] {
  const taken: Box[] = requests.map((q) => ({ l: q.ax - DOT, t: q.ay - DOT, r: q.ax + DOT, b: q.ay + DOT }));
  const out: PlacedLabel[] = [];
  const ordered = [...requests.filter((q) => q.fixed), ...requests.filter((q) => !q.fixed)];
  for (const q of ordered) {
    if (out.length >= MAX_LABELS) break;
    const spots: [number, number][] = q.fixed ? [[q.ax, q.ay - q.h]] : candidates(q);
    for (const [left, top] of spots) {
      const box = { l: left, t: top, r: left + q.w, b: top + q.h };
      if (box.l < 0 || box.t < 0 || box.r > width || box.b > height) continue;
      if (!q.fixed && taken.some((o) => overlaps(o, box))) continue;
      taken.push(box);
      out.push({ key: q.key, left, top });
      break;
    }
  }
  return out;
}
