/** Babylon's default feel (wheelPrecision 3, panningSensibility 1000) at a camera radius of 10. */
const WHEEL_FEEL = 30;
const PAN_FEEL = 10000;

/**
 * Clip planes and input sensitivity for a scene that fits a camera at `radius`.
 * Babylon's defaults (clip 1 .. 10000) would hide scenes much smaller or larger than ~10 units.
 */
export function cameraScale(radius: number) {
  return {
    minZ: radius / 1000,
    maxZ: radius * 100,
    wheelPrecision: WHEEL_FEEL / radius,
    panningSensibility: PAN_FEEL / radius,
  };
}
