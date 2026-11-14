import type { GoogleGenAI } from "@google/genai";
import type { M1Settings } from "../settings/schema";
import { fillTemplate, fitInline, generateImage, generateJson, imagePart, type GeneratedImage } from "./genai";

export interface FeatureCard {
  hairColor: string;
  hairStyle: string;
  skinTone: string;
  eyes: string;
  notableFeatures: string[];
}

const FEATURE_SCHEMA = {
  type: "object",
  properties: {
    hairColor: { type: "string" },
    hairStyle: { type: "string" },
    skinTone: { type: "string" },
    eyes: { type: "string" },
    notableFeatures: { type: "array", items: { type: "string" } },
  },
  required: ["hairColor", "hairStyle", "skinTone", "eyes", "notableFeatures"],
};

export interface CharacterSheet {
  sheet: GeneratedImage;
  featureCard: FeatureCard;
  costUsd: number;
}

export function featureVars(card: FeatureCard, settings: M1Settings): Record<string, string> {
  return {
    hair_color: card.hairColor,
    hair_style: card.hairStyle,
    skin_tone: card.skinTone,
    eyes: card.eyes,
    features: card.notableFeatures.join(", ") || "none",
    style_notes: settings.prompts.styleNotes,
  };
}

export async function buildCharacterSheet(
  client: GoogleGenAI,
  photo: { data: Buffer; mimeType: string },
  styleRefs: Buffer[],
  settings: M1Settings,
): Promise<CharacterSheet> {
  const card = await generateJson<FeatureCard>(client, settings, {
    model: settings.models.featureCard,
    parts: [imagePart(photo.data, photo.mimeType), { text: settings.prompts.featureCard }],
    schema: FEATURE_SCHEMA,
  });
  const refs = await Promise.all(styleRefs.map((r) => fitInline(r, settings.generation.maxInlineBytes)));
  const prompt = fillTemplate(settings.prompts.characterSheet, featureVars(card.value, settings));
  const sheet = await generateImage(client, settings, {
    model: settings.models.characterSheet,
    parts: [imagePart(photo.data, photo.mimeType), ...refs.map((r) => imagePart(r)), { text: prompt }],
    size: settings.generation.sheetSize,
    aspectRatio: settings.generation.sheetAspectRatio,
    seed: settings.generation.seed,
  });
  return { sheet, featureCard: card.value, costUsd: card.costUsd + sheet.costUsd };
}
