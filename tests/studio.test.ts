import type { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildPrompt, limiter, runStudioJob, StudioOptionsSchema, type StudioOptions, type StudioRef, type StudioVersion } from "../src/pipeline/studio";
import { M1SettingsSchema } from "../src/settings/schema";
import { gradientScene } from "./helpers";

const settings = M1SettingsSchema.parse({});

interface Call { config: { imageConfig?: { aspectRatio?: string; imageSize?: string }; responseMimeType?: string }; parts: { text?: string; inlineData?: unknown }[] }

async function fakeClient(calls: Call[], track?: { active: number; max: number }): Promise<GoogleGenAI> {
  const png = (await sharp({ create: { width: 64, height: 64, channels: 3, background: "#336699" } }).png().toBuffer()).toString("base64");
  return {
    models: {
      generateContent: async (req: { contents: { parts: Call["parts"] }[]; config: Call["config"] }) => {
        if (track) { track.active++; track.max = Math.max(track.max, track.active); }
        calls.push({ config: req.config, parts: req.contents[0]?.parts ?? [] });
        await new Promise((r) => setTimeout(r, 15));
        if (track) track.active--;
        const usageMetadata = { promptTokenCount: 100, candidatesTokenCount: 1120, candidatesTokensDetails: [{ modality: "IMAGE", tokenCount: 1120 }] };
        if (req.config.responseMimeType === "application/json") return { text: '{"prompt":"a much more detailed prompt"}', usageMetadata };
        return { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } }], usageMetadata };
      },
    },
  } as unknown as GoogleGenAI;
}

async function ref(w: number, h: number): Promise<StudioRef> {
  return { data: await gradientScene(w, h), mimeType: "image/png", width: w, height: h };
}

const base: StudioOptions = { mode: "enhance", model: "gemini-3-pro-image", ratio: "auto", size: "4K", versions: 3, prompt: "", improvePrompt: false };

describe("limiter", () => {
  it("never runs more than the limit at once", async () => {
    const run = limiter(2);
    let active = 0, max = 0;
    await Promise.all(Array.from({ length: 8 }, () => run(async () => { active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 5)); active--; })));
    expect(max).toBe(2);
  });
});

describe("options", () => {
  it("rejects an unsupported ratio and more than 4 versions", () => {
    expect(StudioOptionsSchema.safeParse({ ...base, ratio: "7:5" }).success).toBe(false);
    expect(StudioOptionsSchema.safeParse({ ...base, versions: 5 }).success).toBe(false);
    expect(StudioOptionsSchema.safeParse({ ...base, ratio: "16:9" }).success).toBe(true);
  });
  it("builds the enhance prompt with optional extra instructions and uses the raw prompt to generate", () => {
    expect(buildPrompt(base, settings)).toBe(settings.prompts.enhance);
    expect(buildPrompt({ ...base, prompt: "keep paper texture" }, settings)).toContain("keep paper texture");
    expect(buildPrompt({ ...base, mode: "generate", prompt: " a red fox " }, settings)).toBe("a red fox");
  });
});

describe("runStudioJob", () => {
  it("makes the requested number of versions at the requested size, with the ratio snapped to the input", async () => {
    const calls: Call[] = [];
    const versions: StudioVersion[] = [];
    await runStudioJob(await fakeClient(calls), settings, base, [await ref(1600, 900)], limiter(4), (v) => { versions.push(v); });
    expect(versions).toHaveLength(3);
    expect(versions.every((v) => v.png && !v.error)).toBe(true);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.config.imageConfig).toMatchObject({ aspectRatio: "16:9", imageSize: "4K" });
    expect(calls[0]?.parts.filter((p) => p.inlineData)).toHaveLength(1);
    expect(versions[0]?.structureMatch).not.toBeNull();
  });

  it("generate mode sends every reference image with the prompt, and honours an explicit ratio", async () => {
    const calls: Call[] = [];
    const opts: StudioOptions = { ...base, mode: "generate", prompt: "a fox in snow", ratio: "3:4", versions: 2, size: "2K" };
    const out = await runStudioJob(await fakeClient(calls), settings, opts, [await ref(300, 300), await ref(400, 200)], limiter(4), () => undefined);
    expect(out.finalPrompt).toBe("a fox in snow");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.parts.filter((p) => p.inlineData)).toHaveLength(2);
    expect(calls[0]?.config.imageConfig).toMatchObject({ aspectRatio: "3:4", imageSize: "2K" });
  });

  it("generates from a prompt alone with no references", async () => {
    const calls: Call[] = [];
    await runStudioJob(await fakeClient(calls), settings, { ...base, mode: "generate", prompt: "a lighthouse", versions: 1 }, [], limiter(4), () => undefined);
    expect(calls[0]?.parts.filter((p) => p.inlineData)).toHaveLength(0);
    expect(calls[0]?.config.imageConfig?.aspectRatio).toBe("1:1");
  });

  it("improves the prompt once when asked, and sends the improved text", async () => {
    const calls: Call[] = [];
    const out = await runStudioJob(await fakeClient(calls), settings, { ...base, mode: "generate", prompt: "a fox", improvePrompt: true, versions: 2 }, [], limiter(4), () => undefined);
    expect(out.finalPrompt).toBe("a much more detailed prompt");
    expect(calls.filter((c) => c.config.responseMimeType === "application/json")).toHaveLength(1);
    expect(calls.filter((c) => c.parts.some((p) => p.text === "a much more detailed prompt"))).toHaveLength(2);
  });

  it("runs at most the scheduled number of calls in parallel", async () => {
    const calls: Call[] = [];
    const track = { active: 0, max: 0 };
    await runStudioJob(await fakeClient(calls, track), settings, { ...base, versions: 4 }, [await ref(500, 500)], limiter(2), () => undefined);
    expect(track.max).toBeLessThanOrEqual(2);
  });

  it("waits for every version callback to finish before the job resolves", async () => {
    let finished = 0;
    await runStudioJob(await fakeClient([]), settings, { ...base, versions: 3 }, [await ref(300, 300)], limiter(4), async () => {
      await new Promise((r) => setTimeout(r, 40));
      finished++;
    });
    expect(finished).toBe(3);
  });

  it("refuses an empty generate prompt and an enhance job without an image", async () => {
    const c = await fakeClient([]);
    await expect(runStudioJob(c, settings, { ...base, mode: "generate" }, [], limiter(1), () => undefined)).rejects.toThrow(/prompt/);
    await expect(runStudioJob(c, settings, base, [], limiter(1), () => undefined)).rejects.toThrow(/image/);
  });
});
