import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { composite } from "../src/pipeline/composite";
import { cropInstance } from "../src/pipeline/crop";
import { outsideMaskDiff } from "../src/pipeline/qa";
import { M1SettingsSchema } from "../src/settings/schema";
import { ellipseMask, gradientScene, solid } from "./helpers";

const settings = M1SettingsSchema.parse({});
const thr = settings.masking.maskThreshold;

async function run(scene: Buffer, mask: Buffer) {
  const box = await cropInstance(scene, mask, { paddingPct: settings.masking.cropPaddingPct, maskThreshold: thr });
  const out = await solid(box.width * 2, box.height * 2, [10, 40, 220]);
  const res = await composite(scene, out, mask, box, settings);
  return { box, res };
}

describe("composite", () => {
  for (const channels of [3, 4] as const) {
    it(`leaves outside-mask pixels byte-identical on a synthetic ${channels}-channel image`, async () => {
      const scene = await gradientScene(640, 480, channels);
      const mask = await ellipseMask(640, 480, 320, 200, 90, 110);
      const { res } = await run(scene, mask);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const diff = await outsideMaskDiff(scene, res.image, mask, thr);
      expect(diff.identical).toBe(true);
      expect(diff.differingBytes).toBe(0);
      const a = await sharp(scene).raw().toBuffer();
      const b = await sharp(res.image).raw().toBuffer();
      expect(a.equals(b)).toBe(false);
    });
  }

  it("rejects a model output smaller than its crop", async () => {
    const scene = await gradientScene(640, 480);
    const mask = await ellipseMask(640, 480, 320, 200, 90, 110);
    const box = await cropInstance(scene, mask, { paddingPct: 15, maskThreshold: thr });
    const small = await solid(box.width - 1, box.height - 1, [0, 0, 0]);
    const res = await composite(scene, small, mask, box, settings);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/smaller than the crop/);
  });

  it("never modifies the input buffers", async () => {
    const scene = await gradientScene(320, 240);
    const mask = await ellipseMask(320, 240, 160, 120, 40, 50);
    const copy = Buffer.from(scene);
    await run(scene, mask);
    expect(scene.equals(copy)).toBe(true);
  });
});

const names = ["front", "side", "back"] as const;
describe.each(names)("composite on real scene: %s", (name) => {
  const scenePath = `test-data/scenes/${name}.png`;
  const maskPath = `test-data/masks/${name}.png`;
  it.skipIf(!existsSync(scenePath) || !existsSync(maskPath))("outside-mask pixels identical", async () => {
    const [scene, mask] = await Promise.all([readFile(scenePath), readFile(maskPath)]);
    const { res } = await run(scene, mask);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((await outsideMaskDiff(scene, res.image, mask, thr)).identical).toBe(true);
  });
});
