import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { expandTemplate, exactMatch } from "../src/pipeline/ocr";
import type { InstanceDef } from "../src/pipeline/render";
import { runScene } from "../src/pipeline/scene";
import { verdictFor, type QaScores } from "../src/pipeline/verdict";
import { M1SettingsSchema } from "../src/settings/schema";
import { ctxFor, fakeClient, memRecorder, testSettings } from "./fake";
import { ellipseMask, gradientScene, solid } from "./helpers";

const W = 900, H = 600;

async function rectMask(x: number, y: number, w: number, h: number): Promise<Buffer> {
  const data = Buffer.alloc(W * H);
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) data[j * W + i] = 255;
  return sharp(data, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
}

async function collage() {
  const original = await gradientScene(W, H);
  const head = (id: string, cx: number, age: InstanceDef["ageStage"], view: InstanceDef["view"]) => ellipseMask(W, H, cx, 150, 60, 75).then((mask): InstanceDef => ({ id, kind: "character", view, ageStage: age, mask }));
  const a = await head("panel-a", 150, "child", "front");
  const b = await head("panel-b", 450, "teen", "side");
  const jersey: InstanceDef = { id: "jersey", kind: "art_text", view: "back", ageStage: "adult", mask: await rectMask(640, 120, 200, 70), originalWords: "ALI 7", newWordsTemplate: "{HERO} 10" };
  return { original, a, b, jersey };
}

const sheet = () => solid(300, 200, [200, 160, 120]);

describe("helpers", () => {
  it("expands name tokens and compares letter for letter", () => {
    expect(expandTemplate("{HERO} 26", { hero: "Samir" })).toBe("SAMIR 26");
    expect(expandTemplate("{hero}'s star", { hero: "Samir" })).toBe("Samir's star");
    expect(exactMatch(" OMAR  10 ", "OMAR 10")).toBe(true);
    expect(exactMatch("OMAR 1O", "OMAR 10")).toBe(false);
    expect(exactMatch("omar 10", "OMAR 10")).toBe(false);
  });

  it("never lets a vision score pass art text without an exact read-back", () => {
    const base: QaScores = { outsideIdentical: true, outsideDiffBytes: 0, edgeSsim: 0.9, seamDelta: 1, sharpnessRatio: 3, sharpnessBaseline: 3, ocr: null, visionError: null, vision: { likeness: 10, featureMatch: 10, styleMatch: 10, overall: 10, artifacts: [], extraFaces: false, pass: true, reason: "perfect" } };
    const t = M1SettingsSchema.parse({}).qa;
    expect(verdictFor("art_text", base, t).pass).toBe(false);
    expect(verdictFor("art_text", { ...base, ocr: { expected: "OMAR 10", exact: false, reads: [{ model: "m", text: "OMAR 1O", error: null }] } }, t).pass).toBe(false);
    expect(verdictFor("art_text", { ...base, ocr: { expected: "OMAR 10", exact: true, reads: [{ model: "m", text: "OMAR 10", error: null }] } }, t).pass).toBe(true);
  });
});

describe("sharpness is judged against the original region", () => {
  const t = M1SettingsSchema.parse({}).qa;
  const ok: QaScores = { outsideIdentical: true, outsideDiffBytes: 0, edgeSsim: 0.9, seamDelta: 1, sharpnessRatio: 1.2, sharpnessBaseline: 1.56, visionError: null, ocr: null, vision: { likeness: 9, featureMatch: 9, styleMatch: 9, overall: 9, artifacts: [], extraFaces: false, pass: true, reason: "good" } };
  it("accepts a naturally smooth scene (stadium crowd) and rejects a result much softer than the original", () => {
    expect(verdictFor("character", ok, t).pass).toBe(true);
    const soft = verdictFor("character", { ...ok, sharpnessRatio: 0.2 }, t);
    expect(soft.pass).toBe(false);
    expect(soft.reasons.join()).toContain("soft result");
  });
});

describe("runScene", () => {
  it("runs a collage with an art-text jersey unattended, records every candidate and keeps everything else identical", async () => {
    const { original, a, b, jersey } = await collage();
    const { client, calls } = await fakeClient();
    const rec = memRecorder();
    const settings = testSettings({ candidates: 2 });
    const out = await runScene(await ctxFor(settings, client, rec, await sheet()), { id: "s1", original, instances: [a, b, jersey], fixedMasks: [] });

    expect(out.status).toBe("done");
    expect(out.flagged).toEqual([]);
    expect(out.outsideUnionIdentical).toBe(true);
    expect(rec.records).toHaveLength(6);
    expect(rec.selected).toHaveLength(3);
    expect(rec.records.every((r) => r.settingsVersion === 7 && r.promptVersion.startsWith("7:") && r.costUsd > 0 && r.inputs.promptSha)).toBe(true);
    expect(out.costUsd).toBeCloseTo(rec.records.reduce((s, r) => s + r.costUsd, 0), 6);
    expect(calls.filter((c) => c.kind === "judge")).toHaveLength(4);
    expect(calls.filter((c) => c.kind === "ocr")).toHaveLength(4);
    const jerseyPrompt = rec.records.find((r) => r.instanceId === "jersey")?.inputs.prompt as string;
    expect(jerseyPrompt).toContain('"OMAR 10"');
    expect(jerseyPrompt).toContain('"ALI 7"');
    const teenPrompt = rec.records.find((r) => r.instanceId === "panel-b")?.inputs.prompt as string;
    expect(teenPrompt).toContain("teenager");

    const before = await sharp(original).raw().toBuffer();
    const after = await sharp(out.image).raw().toBuffer();
    expect(before.equals(after)).toBe(false);
  });

  it("retries as a new version with the failure reasons as a hint, then passes", async () => {
    const { original, a } = await collage();
    const { client, calls } = await fakeClient({ judgePass: (n) => n >= 2 });
    const rec = memRecorder();
    const out = await runScene(await ctxFor(testSettings({ candidates: 2, maxAutoRetries: 2 }), client, rec, await sheet()), { id: "s", original, instances: [a], fixedMasks: [] });
    expect(out.results[0]?.status).toBe("passed");
    expect(out.results[0]?.rounds).toBe(2);
    expect(rec.records.map((r) => r.version)).toEqual([1, 1, 2, 2]);
    expect(rec.records.filter((r) => r.status === "failed_qa")).toHaveLength(2);
    const imagePrompts = calls.filter((c) => c.kind === "image").map((c) => c.prompt);
    expect(imagePrompts.slice(0, 2).every((p) => !p.includes("Fix these problems"))).toBe(true);
    expect(imagePrompts.slice(2).every((p) => p.includes("Fix these problems"))).toBe(true);
  });

  it("flags an instance that never passes and leaves its pixels untouched", async () => {
    const { original, a, b } = await collage();
    const { client } = await fakeClient({ judgePass: () => false });
    const rec = memRecorder();
    const out = await runScene(await ctxFor(testSettings({ candidates: 2, maxAutoRetries: 1 }), client, rec, await sheet()), { id: "s", original, instances: [a, b], fixedMasks: [] });
    expect(out.status).toBe("flagged");
    expect(out.flagged.map((f) => f.instanceId).sort()).toEqual(["panel-a", "panel-b"]);
    expect(out.results.every((r) => r.rounds === 2 && r.chosen === null && r.bestFailed !== null)).toBe(true);
    expect(rec.records).toHaveLength(8);
    expect(rec.selected).toHaveLength(0);
    const before = await sharp(original).raw().toBuffer();
    expect((await sharp(out.image).raw().toBuffer()).equals(before)).toBe(true);
  });

  it("fails art text on a wrong read, never consults the vision judge, and passes once every OCR model reads it exactly", async () => {
    const { original, jersey } = await collage();
    const wrong = await fakeClient({ ocrText: () => "OMAR 1O" });
    const r1 = await runScene(await ctxFor(testSettings({ candidates: 1, maxAutoRetries: 0 }), wrong.client, memRecorder(), await sheet()), { id: "s", original, instances: [jersey], fixedMasks: [] });
    expect(r1.status).toBe("flagged");
    expect(r1.results[0]?.reasons.join()).toContain('does not read "OMAR 10"');
    expect(wrong.calls.some((c) => c.kind === "judge")).toBe(false);

    const oneModelWrong = await fakeClient({ ocrText: (_n, model) => (model === "gemini-3.1-pro-preview" ? "OMAR 18" : "OMAR 10") });
    const r2 = await runScene(await ctxFor(testSettings({ candidates: 1, maxAutoRetries: 0 }), oneModelWrong.client, memRecorder(), await sheet()), { id: "s", original, instances: [jersey], fixedMasks: [] });
    expect(r2.status).toBe("flagged");

    const retry = await fakeClient({ ocrText: (n) => (n < 2 ? "OMAR 11" : "OMAR 10") });
    const r3 = await runScene(await ctxFor(testSettings({ candidates: 1, maxAutoRetries: 2 }), retry.client, memRecorder(), await sheet()), { id: "s", original, instances: [jersey], fixedMasks: [] });
    expect(r3.status).toBe("done");
    expect(r3.results[0]?.rounds).toBe(2);
  });

  it("refuses to edit a mask that touches a fixed person or another instance, without calling the model for it", async () => {
    const { original, a, b } = await collage();
    const { client, calls } = await fakeClient();
    const fixed = { id: "coach", mask: await ellipseMask(W, H, 470, 150, 40, 60) };
    const overlapping: InstanceDef = { ...a, id: "dup", mask: await ellipseMask(W, H, 160, 150, 60, 75) };
    const out = await runScene(await ctxFor(testSettings({ candidates: 1 }), client, memRecorder(), await sheet()), { id: "s", original, instances: [a, overlapping, b], fixedMasks: [fixed] });
    const reasons = Object.fromEntries(out.flagged.map((f) => [f.instanceId, f.reason]));
    expect(reasons["panel-b"]).toContain('fixed person "coach"');
    expect(reasons["dup"]).toContain('instance "panel-a"');
    expect(calls.filter((c) => c.kind === "image")).toHaveLength(1);
    expect(out.results).toHaveLength(1);
    expect(out.status).toBe("flagged");
  });
});
