import { readFileSync } from "node:fs";
import { APIRequestContext, Page, expect, test } from "@playwright/test";

/** Post a scene saved by an example script (`--save frontend/e2e/scenes/<name>.json`) to the server. */
async function postScene(request: APIRequestContext, name: string): Promise<void> {
  const doc = JSON.parse(readFileSync(new URL(`./scenes/${name}.json`, import.meta.url), "utf8"));
  const res = await request.post("/api/objects", { data: doc });
  expect(res.ok()).toBe(true);
}

/** Pixels of the 3D canvas within 40 (per channel) of `hex`, after two frames. */
const pixelsLike = (page: Page, hex: string) =>
  page.evaluate(async (hex) => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const src = document.getElementById("canvas3d") as HTMLCanvasElement;
    const c = document.createElement("canvas");
    [c.width, c.height] = [src.width, src.height];
    const ctx = c.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (want.every((w, k) => Math.abs(px[i + k] - w) <= 40)) n++;
    return n;
  }, hex);

type CameraState = { alpha: number; beta: number; radius: number; ortho: boolean };
const camera3d = (page: Page): Promise<CameraState> =>
  page.evaluate(() => (window as unknown as { __gv: { view3d: { cameraState: CameraState } } }).__gv.view3d.cameraState);

test.beforeEach(async ({ request }) => {
  await request.post("/api/clear", { data: {} });
});

test("the quadrics scene renders in 3D with its intersection curves", async ({ page, request }) => {
  await postScene(request, "quadrics_3d");
  await page.goto("/");
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "3d");
  await expect(page.locator("#count")).toHaveText("7 objects");
  await expect.poll(() => pixelsLike(page, "#c47f00")).toBeGreaterThan(100); // SY₁, 3 px wide
  await expect.poll(() => pixelsLike(page, "#b5448f")).toBeGreaterThan(100); // ΠK
});

test("the 3D toolbar snaps the camera and switches to orthographic", async ({ page, request }) => {
  await postScene(request, "quadrics_3d");
  await page.goto("/");
  await expect(page.locator("#count")).toHaveText("7 objects");
  await page.locator(".toolbar3d [data-snap=top]").click();
  expect((await camera3d(page)).beta).toBeLessThan(1e-3);
  await page.locator(".toolbar3d [data-snap=front]").click();
  expect((await camera3d(page)).beta).toBeCloseTo(Math.PI / 2, 6);
  await page.locator(".toolbar3d [data-projection]").click();
  await expect(page.locator(".toolbar3d [data-projection]")).toHaveText("ortho");
  expect((await camera3d(page)).ortho).toBe(true);
  await expect.poll(() => pixelsLike(page, "#c47f00")).toBeGreaterThan(100);
});

test("hovering a 3D curve highlights it and shows its parameter and point", async ({ page, request }) => {
  await postScene(request, "quadrics_3d");
  await page.goto("/");
  await expect(page.locator("#count")).toHaveText("7 objects");
  await expect.poll(() => pixelsLike(page, "#c47f00")).toBeGreaterThan(100); // drawn, so the camera has its first frame
  const [x, y] = await page.evaluate(() => {
    const gv = (window as unknown as { __gv: { view3d: { screenOf(p: number[]): number[]; canvas: HTMLCanvasElement } } }).__gv;
    const s = gv.view3d.screenOf([0, -2, Math.sqrt(5)]); // SY₁: the circle of radius 2 at z = √5
    const r = gv.view3d.canvas.getBoundingClientRect();
    return [r.left + s[0], r.top + s[1]];
  });
  await page.mouse.move(x, y);
  const tooltip = page.locator("#view3d .tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip.locator(".head")).toHaveText("SY₁ · circle");
  await expect(tooltip).toContainText("t = ");
  await expect(tooltip).toContainText(", 2.236)"); // on SY₁, whatever t the pointer lands on
  await expect(page.locator("#view3d .labels .label.lit")).toHaveText("SY₁");
});
