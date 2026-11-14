import type { GoogleGenAI } from "@google/genai";
import type { M1Settings } from "../settings/schema";
import { fillTemplate, fitInline, generateJson, imagePart } from "./genai";
import type { FeatureCard } from "./sheet";

export interface JudgeResult {
  likeness: number;
  featureMatch: number;
  styleMatch: number;
  overall: number;
  artifacts: string[];
  extraFaces: boolean;
  pass: boolean;
  reason: string;
}

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    likeness: { type: "number" },
    featureMatch: { type: "number" },
    styleMatch: { type: "number" },
    overall: { type: "number" },
    artifacts: { type: "array", items: { type: "string" } },
    extraFaces: { type: "boolean" },
    pass: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["likeness", "featureMatch", "styleMatch", "overall", "artifacts", "extraFaces", "pass", "reason"],
};

export async function visionJudge(
  client: GoogleGenAI,
  input: { sheet: Buffer; originalCrop: Buffer; editedCrop: Buffer; featureCard: FeatureCard; view: string },
  settings: M1Settings,
): Promise<{ result: JudgeResult; costUsd: number }> {
  const max = settings.generation.maxInlineBytes;
  const [s, o, e] = await Promise.all([
    fitInline(input.sheet, max),
    fitInline(input.originalCrop, max),
    fitInline(input.editedCrop, max),
  ]);
  const prompt = fillTemplate(settings.prompts.judge, {
    feature_card: JSON.stringify(input.featureCard),
    view: input.view,
  });
  const r = await generateJson<JudgeResult>(client, settings, {
    model: settings.models.visionJudge,
    parts: [imagePart(s), imagePart(o), imagePart(e), { text: prompt }],
    schema: JUDGE_SCHEMA,
  });
  return { result: r.value, costUsd: r.costUsd };
}
