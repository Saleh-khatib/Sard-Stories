import { describe, expect, it } from "vitest";
import { chooseOutputSize } from "../src/pipeline/size";
import { SUPPORTED_RATIOS, cropInstance, snapBox } from "../src/pipeline/crop";
import { M1SettingsSchema } from "../src/settings/schema";
import { ellipseMask, gradientScene } from "./helpers";

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

describe("snapBox", () => {
  it("never cuts the mask, stays inside the image and returns a supported ratio", () => {
    const r = rng(7);
    const labels = new Set<string>(SUPPORTED_RATIOS.map((x) => x.label));
    for (let n = 0; n < 2000; n++) {
      const imgW = 400 + Math.floor(r() * 3000);
      const imgH = 400 + Math.floor(r() * 3000);
      const cap = Math.min(imgW, imgH) / 2;
      const bw = 20 + Math.floor(r() * (cap - 20));
      const bh = 20 + Math.floor(r() * (cap - 20));
      const left = Math.floor(r() * (imgW - bw));
      const top = Math.floor(r() * (imgH - bh));
      const pad = Math.floor(r() * 30);
      const box = snapBox({ left, top, width: bw, height: bh }, imgW, imgH, pad);
      expect(labels.has(box.ratio)).toBe(true);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.left + box.width).toBeLessThanOrEqual(imgW);
      expect(box.top + box.height).toBeLessThanOrEqual(imgH);
      expect(box.left).toBeLessThanOrEqual(left);
      expect(box.top).toBeLessThanOrEqual(top);
      expect(box.left + box.width).toBeGreaterThanOrEqual(left + bw);
      expect(box.top + box.height).toBeGreaterThanOrEqual(top + bh);
      const ratio = SUPPORTED_RATIOS.find((x) => x.label === box.ratio)!;
      expect(box.width * ratio.h).toBe(box.height * ratio.w);
    }
  });

  it("works on a mask at the image corner", () => {
    const box = snapBox({ left: 0, top: 0, width: 100, height: 140 }, 800, 600, 15);
    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
    expect(box.width).toBeGreaterThanOrEqual(100);
  });
});

describe("cropInstance", () => {
  it("covers a real mask image and rejects a mismatched or empty mask", async () => {
    const scene = await gradientScene(800, 600);
    const mask = await ellipseMask(800, 600, 400, 250, 80, 100);
    const box = await cropInstance(scene, mask, { paddingPct: 15, maskThreshold: 128 });
    expect(box.left).toBeLessThanOrEqual(320);
    expect(box.left + box.width).toBeGreaterThanOrEqual(480);
    expect(box.top).toBeLessThanOrEqual(150);
    expect(box.top + box.height).toBeGreaterThanOrEqual(350);
    await expect(cropInstance(scene, await ellipseMask(400, 300, 100, 100, 10, 10), { paddingPct: 15, maskThreshold: 128 })).rejects.toThrow(/Mask is/);
    await expect(cropInstance(scene, await ellipseMask(800, 600, 0, 0, 0, 0), { paddingPct: 15, maskThreshold: 128 })).rejects.toThrow(/empty/);
  });
});

describe("chooseOutputSize", () => {
  const g = M1SettingsSchema.parse({}).generation;
  it("is always at or above the crop's longest side", () => {
    expect(chooseOutputSize(900, 600, g)).toBe("1K");
    expect(chooseOutputSize(1025, 600, g)).toBe("2K");
    expect(chooseOutputSize(2048, 1000, g)).toBe("2K");
    expect(chooseOutputSize(2049, 1000, g)).toBe("4K");
  });
  it("honours forceSize", () => {
    expect(chooseOutputSize(100, 100, { ...g, forceSize: "4K" })).toBe("4K");
  });
});
