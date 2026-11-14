import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { edgeSimilarity, outsideMaskIdentical, seamDelta, sharpnessRatio } from "../src/pipeline/qa";
import { readMaskBinary } from "../src/pipeline/maskops";
import { M1SettingsSchema } from "../src/settings/schema";
import { ellipseMask, gradientScene, solid } from "./helpers";

const { masking } = M1SettingsSchema.parse({});

async function maskBits(w: number, h: number) {
  const m = await readMaskBinary(await ellipseMask(w, h, w / 2, h / 2, w / 4, h / 4), masking.maskThreshold);
  return m.bin;
}

describe("qa metrics", () => {
  const w = 300, h = 300;

  it("edgeSimilarity is ~1 for identical crops and lower for different structure", async () => {
    const a = await gradientScene(w, h);
    const bits = await maskBits(w, h);
    const same = await edgeSimilarity(a, a, bits, w, h, masking);
    expect(same).toBeGreaterThan(0.99);
    const flat = await solid(w, h, [128, 128, 128]);
    const diff = await edgeSimilarity(a, flat, bits, w, h, masking);
    expect(diff).toBeLessThan(same);
  });

  it("seamDelta is ~0 on a flat image and large when inside and outside differ", async () => {
    const bits = await maskBits(w, h);
    expect(await seamDelta(await solid(w, h, [100, 100, 100]), bits, w, h, masking)).toBeLessThan(0.01);
    const raw = Buffer.alloc(w * h * 3, 100);
    for (let i = 0; i < bits.length; i++) if (bits[i]) raw[i * 3] = 220;
    const png = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    expect(await seamDelta(png, bits, w, h, masking)).toBeGreaterThan(100);
  });

  it("sharpnessRatio is lower for a blurred head than a sharp surround", async () => {
    const bits = await maskBits(w, h);
    const sharpImg = await gradientScene(w, h);
    const blurred = await sharp(sharpImg).blur(6).toBuffer();
    const raw = await sharp(sharpImg).raw().toBuffer();
    const blurRaw = await sharp(blurred).raw().toBuffer();
    for (let i = 0; i < bits.length; i++) if (bits[i]) for (let c = 0; c < 3; c++) raw[i * 3 + c] = blurRaw[i * 3 + c] as number;
    const mixed = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    const r = await sharpnessRatio(mixed, bits, w, h, masking);
    expect(r).toBeLessThan(0.5);
    expect(await sharpnessRatio(sharpImg, bits, w, h, masking)).toBeGreaterThan(0.5);
  });

  it("outsideMaskIdentical detects a single changed pixel outside the mask", async () => {
    const a = await gradientScene(w, h);
    const mask = await ellipseMask(w, h, w / 2, h / 2, w / 4, h / 4);
    expect(await outsideMaskIdentical(a, a, mask, 128)).toBe(true);
    const raw = await sharp(a).raw().toBuffer();
    raw[0] = (raw[0] as number) ^ 1;
    const b = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    expect(await outsideMaskIdentical(a, b, mask, 128)).toBe(false);
  });
});
