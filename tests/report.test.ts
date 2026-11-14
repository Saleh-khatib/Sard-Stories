import { describe, expect, it } from "vitest";
import { renderReport } from "../src/pipeline/report";
import { judgeVerdict, type RunSummary } from "../src/pipeline/runM1";
import { M1SettingsSchema } from "../src/settings/schema";

const qa = M1SettingsSchema.parse({}).qa;
const goodQa = {
  outsideIdentical: true, outsideDiffBytes: 0, edgeSsim: 0.8, seamDelta: 5, seamDeltaBaseline: 3,
  sharpnessRatio: 0.9, sharpnessBaseline: 1,
  vision: { likeness: 8, featureMatch: 8, styleMatch: 9, overall: 8, artifacts: [], extraFaces: false, pass: true, reason: "good" },
  visionError: null,
};

describe("verdict", () => {
  it("passes a good candidate and lists every failed check", () => {
    expect(judgeVerdict(goodQa, qa).pass).toBe(true);
    const bad = judgeVerdict({ ...goodQa, outsideIdentical: false, edgeSsim: 0.1, seamDelta: 99, sharpnessRatio: 0.1, vision: null, visionError: "x" }, qa);
    expect(bad.pass).toBe(false);
    expect(bad.reasons.length).toBe(5);
  });
});

describe("renderReport", () => {
  it("renders scenes, candidates, totals and escapes text", () => {
    const summary: RunSummary = {
      runId: "r1", createdAt: "now", settingsVersion: 1, child: { name: "<b>Omar</b>", gender: "boy" }, models: ["m1"],
      sheet: { file: "sheet/sheet.png", costUsd: 0.1, featureCard: { hairColor: "black", hairStyle: "short", skinTone: "olive", eyes: "brown", notableFeatures: [] } },
      scenes: [{
        scene: "front", view: "front", box: { left: 0, top: 0, width: 100, height: 100, ratio: "1:1" }, sceneSize: [1000, 800],
        files: { original: "front/original.png", mask: "front/mask.png", crop: "front/crop.png", outlined: "front/outlined.png" },
        instanceMs: { m1: 1000 },
        candidates: [{
          scene: "front", model: "m1", n: 1, status: "ok", reason: null, requestedSize: "1K", outputSize: [1024, 1024], attempts: [],
          aspectErrorPct: 0, seamShift: null, qa: goodQa, verdict: { pass: true, reasons: [] }, costUsd: 0.2, genMs: 5000,
          files: { raw: "front/m1/1/raw.png", composite: "front/m1/1/composite.png", compositeCrop: "front/m1/1/composite-crop.png" },
        }],
      }],
      totals: [{ model: "m1", candidates: 1, passed: 1, rejected: 0, errors: 0, costUsd: 0.2, avgInstanceMs: 1000, avg: { edgeSsim: 0.8, seamDelta: 5, sharpnessRatio: 0.9, visionOverall: 8, likeness: 8, styleMatch: 9 } }],
      totalCostUsd: 0.3, thresholds: qa,
    };
    const html = renderReport(summary, "r1/");
    expect(html).toContain('src="r1/front/m1/1/composite-crop.png"');
    expect(html).toContain("PASS");
    expect(html).not.toContain("<b>Omar</b>");
    expect(html).toContain("&lt;b&gt;Omar");
  });
});
