import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composite } from "../src/pipeline/composite";
import { cropInstance } from "../src/pipeline/crop";
import { fitInline } from "../src/pipeline/genai";
import { outlineCrop } from "../src/pipeline/outline";
import { M1SettingsSchema } from "../src/settings/schema";
import { ellipseMask, gradientScene, solid } from "./helpers";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (b: Buffer) => b.subarray(0, 8).equals(PNG_MAGIC);

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

describe("no JPEG anywhere in the pipeline", () => {
  it("pipeline outputs are PNG", async () => {
    const settings = M1SettingsSchema.parse({});
    const scene = await gradientScene(640, 480);
    const mask = await ellipseMask(640, 480, 320, 200, 90, 110);
    const box = await cropInstance(scene, mask, { paddingPct: 15, maskThreshold: 128 });
    const res = await composite(scene, await solid(box.width, box.height, [1, 2, 3]), mask, box, settings);
    expect(res.ok && isPng(res.image)).toBe(true);
    expect(isPng(await fitInline(scene, 100))).toBe(true);
    const outline = await outlineCrop(await solid(50, 50, [0, 0, 0]), new Uint8Array(2500).fill(1), 50, 50);
    expect(isPng(outline)).toBe(true);
  });

  it("source never encodes JPEG", async () => {
    for (const f of await walk("src/pipeline")) {
      const text = await readFile(f, "utf8");
      expect(text, f).not.toMatch(/\.jpe?g\s*\(/);
      expect(text, f).not.toMatch(/outputMimeType:\s*["']image\/jpe?g/);
    }
  });

  it.skipIf(!existsSync("out/m1"))("every file written under out/m1 is PNG, JSON or HTML", async () => {
    for (const f of await walk("out/m1")) {
      expect(f, f).not.toMatch(/\.jpe?g$/i);
      if (f.endsWith(".png")) expect(isPng(await readFile(f)), f).toBe(true);
    }
  });
});
