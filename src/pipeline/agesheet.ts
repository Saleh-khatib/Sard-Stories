import type { GoogleGenAI } from "@google/genai";
import type { AgeStage } from "../db/schema";
import type { M1Settings } from "../settings/schema";
import { fillTemplate, fitInline, generateImage, imagePart, type GeneratedImage } from "./genai";
import { featureVars, type FeatureCard } from "./sheet";
import type { Schedule } from "./studio";

/** The same child at another age, derived from the approved base sheet so hair, skin and face carry over. */
export async function buildAgeSheet(
  client: GoogleGenAI,
  settings: M1Settings,
  baseSheet: Buffer,
  card: FeatureCard,
  stage: AgeStage,
  schedule: Schedule,
): Promise<GeneratedImage> {
  const prompt = fillTemplate(settings.prompts.ageSheet, { ...featureVars(card, settings), stage_desc: settings.prompts.ageStageDesc[stage] });
  const ref = await fitInline(baseSheet, settings.generation.maxInlineBytes);
  return schedule(() =>
    generateImage(client, settings, {
      model: settings.models.characterSheet,
      parts: [imagePart(ref), { text: prompt }],
      size: settings.generation.sheetSize,
      aspectRatio: settings.generation.sheetAspectRatio,
      seed: settings.generation.seed,
    }),
  );
}
