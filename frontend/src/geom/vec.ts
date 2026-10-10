export type Vec3 = [number, number, number];

/** Right-handed orthonormal frame: origin plus unit axes (protocol `frame`). */
export interface Frame {
  o: Vec3;
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

export interface Box {
  min: Vec3;
  max: Vec3;
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/** `o + cx·x + cy·y + cz·z` — every analytic parametrization has this shape. */
export function inFrame(f: Frame, cx: number, cy: number, cz = 0): Vec3 {
  return [
    f.o[0] + cx * f.x[0] + cy * f.y[0] + cz * f.z[0],
    f.o[1] + cx * f.x[1] + cy * f.y[1] + cz * f.z[1],
    f.o[2] + cx * f.x[2] + cy * f.y[2] + cz * f.z[2],
  ];
}
