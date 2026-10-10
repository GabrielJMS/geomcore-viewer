import type { SceneObject } from "../protocol";

export const DEFAULT_COLOR = "#30638e";

export const colorOf = (o: SceneObject): string => o.style?.color ?? DEFAULT_COLOR;
