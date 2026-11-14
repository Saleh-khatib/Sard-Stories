import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { nearestRatio, resampleMask } from "../src/pipeline/enhance";
import { readMaskBinary } from "../src/pipeline/maskops";
import { M1SettingsSchema } from "../src/settings/schema";
import { ellipseMask } from "./helpers";

describe("nearestRatio", () => {
  it("picks the closest supported ratio", () => {
    expect(nearestRatio(1254, 1254)).toEqual({ label: "1:1", errorPct: 0 });
    expect(nearestRatio(1600, 900).label).toBe("16:9");
    expect(nearestRatio(1000, 1490).label).toBe("2:3");
    expect(nearestRatio(2100, 900).label).toBe("21:9");
  });
});

describe("resampleMask", () => {
  it("keeps only 0 and 255 and keeps the shape at the new size", async () => {
    const mask = await ellipseMask(300, 300, 150, 150, 60, 80);
    const big = await resampleMask(mask, 1200, 1200);
    const meta = await sharp(big).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 1200]);
    const raw = await sharp(big).extractChannel(0).raw().toBuffer();
    expect(new Set(raw).size).toBeLessThanOrEqual(2);
    const bin = await readMaskBinary(big, 128);
    let white = 0;
    for (const v of bin.bin) white += v;
    const expected = Math.PI * 60 * 80 * 16;
    expect(Math.abs(white - expected) / expected).toBeLessThan(0.03);
  });
});

describe("enhance settings", () => {
  it("defaults to 4K on the pro image model with one candidate", () => {
    const e = M1SettingsSchema.parse({}).enhance;
    expect([e.model, e.size, e.candidates]).toEqual(["gemini-3-pro-image", "4K", 1]);
  });
});
