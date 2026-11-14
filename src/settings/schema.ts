import { z } from "zod";

export const OUTPUT_SIZES = ["1K", "2K", "4K"] as const;
export const OutputSizeSchema = z.enum(OUTPUT_SIZES);
export type OutputSize = z.infer<typeof OutputSizeSchema>;

const PriceSchema = z.object({
  inputPerM: z.number().min(0),
  outputImagePerM: z.number().min(0),
  outputTextPerM: z.number().min(0),
});
export type Price = z.infer<typeof PriceSchema>;

export const ConnectionSchema = z.object({
  project: z.string().default(""),
  location: z.string().default("global"),
});

export const ModelsSchema = z.object({
  sceneEdit: z.string().default("gemini-3-pro-image"),
  characterSheet: z.string().default("gemini-3-pro-image"),
  visionJudge: z.string().default("gemini-2.5-flash"),
  featureCard: z.string().default("gemini-2.5-flash"),
  compare: z.array(z.string()).default(["gemini-3-pro-image", "gemini-3.1-flash-image"]),
  prices: z
    .record(z.string(), PriceSchema)
    .default({
      "gemini-3-pro-image": { inputPerM: 2, outputImagePerM: 120, outputTextPerM: 12 },
      "gemini-3.1-flash-image": { inputPerM: 0.5, outputImagePerM: 60, outputTextPerM: 3 },
      "gemini-2.5-flash-image": { inputPerM: 0.3, outputImagePerM: 30, outputTextPerM: 2.5 },
      "gemini-2.5-flash": { inputPerM: 0.3, outputImagePerM: 0, outputTextPerM: 2.5 },
    }),
});

export const GenerationSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.2),
  topP: z.number().min(0).max(1).default(0.95),
  seed: z.number().int().nullable().default(null),
  candidates: z.number().int().min(1).max(4).default(3),
  concurrency: z.number().int().min(1).max(16).default(4),
  sizeRule: z
    .object({
      maxLongSideFor1K: z.number().int().default(1024),
      maxLongSideFor2K: z.number().int().default(2048),
    })
    .default({ maxLongSideFor1K: 1024, maxLongSideFor2K: 2048 }),
  forceSize: z.enum(["off", ...OUTPUT_SIZES]).default("off"),
  sheetSize: OutputSizeSchema.default("1K"),
  sheetAspectRatio: z.string().default("3:2"),
  personGeneration: z.enum(["ALLOW_ALL", "ALLOW_ADULT", "ALLOW_NONE"]).default("ALLOW_ALL"),
  maxAspectErrorPct: z.number().min(0).default(3),
  maxInlineBytes: z.number().int().default(7_000_000),
  retry: z
    .object({ maxTries: z.number().int().min(1).default(3), baseDelayMs: z.number().int().default(2000) })
    .default({ maxTries: 3, baseDelayMs: 2000 }),
});

export const MaskingSchema = z.object({
  cropPaddingPct: z.number().min(0).default(15),
  featherPx: z.number().min(0).default(8),
  seamColorMatch: z.boolean().default(true),
  seamMaxShift: z.number().min(0).default(40),
  seamBandPx: z.number().int().min(1).default(12),
  maskThreshold: z.number().int().min(1).max(255).default(128),
  sharpnessRingPx: z.number().int().min(1).default(64),
  qaMaxSidePx: z.number().int().default(1024),
});

export const QaSchema = z.object({
  edgeSsimMin: z.number().default(0.3),
  seamDeltaMax: z.number().default(25),
  sharpnessRatioMin: z.number().default(0.5),
  visionScoreMin: z.number().default(7),
  maxAutoRetries: z.number().int().default(2),
});

export const PromptsSchema = z.object({
  characterSheet: z
    .string()
    .default(
      "Create a character sheet of the child in the photo, drawn in the same art style as the reference illustrations ({style_notes}). Show the head and upper body from the front, in profile and from behind. Keep the child's real hair colour ({hair_color}), hair style ({hair_style}), skin tone ({skin_tone}) and eye colour ({eyes}). Notable features: {features}. Plain light background, no text.",
    ),
  sceneEditFront: z
    .string()
    .default(
      "Image 1 is an illustration crop. Image 2 is the same crop with the area to edit outlined in red. Image 3 is the character sheet of the new child ({name}, {gender}). Replace the hero's head and neck inside the red outline with the child from the sheet, seen from the FRONT, in exactly the same art style, line weight, shading and lighting. Hair: {hair_color}, {hair_style}. Skin: {skin_tone}. Eyes: {eyes}. Do not change anything outside the red outline. Do not draw the red outline. Do not add extra faces or text.",
    ),
  sceneEditSide: z
    .string()
    .default(
      "Image 1 is an illustration crop. Image 2 is the same crop with the area to edit outlined in red. Image 3 is the character sheet of the new child ({name}, {gender}). Replace the hero's head and neck inside the red outline with the child from the sheet, seen in PROFILE facing the same direction as the original, in exactly the same art style, line weight, shading and lighting. Hair: {hair_color}, {hair_style}. Skin: {skin_tone}. Do not change anything outside the red outline. Do not draw the red outline. Do not add extra faces or text.",
    ),
  sceneEditBack: z
    .string()
    .default(
      "Image 1 is an illustration crop. Image 2 is the same crop with the area to edit outlined in red. Image 3 is the character sheet of the new child ({name}, {gender}). Replace the hero's head and neck inside the red outline with the back of the child's head from the sheet, seen from BEHIND, in exactly the same art style, line weight, shading and lighting. Hair: {hair_color}, {hair_style}. Skin tone of the neck: {skin_tone}. No face may be visible. Do not change anything outside the red outline. Do not draw the red outline. Do not add extra faces or text.",
    ),
  featureCard: z
    .string()
    .default(
      "Look at this photo of a child and describe only visible physical features as JSON: hairColor, hairStyle, skinTone, eyes, notableFeatures (array of short strings, e.g. glasses, freckles, dimples). Be concise and factual.",
    ),
  judge: z
    .string()
    .default(
      "You are a strict art-director checking a personalised children's book illustration. Image 1 is the character sheet of the child. Image 2 is the ORIGINAL crop. Image 3 is the EDITED crop. Feature card: {feature_card}. View: {view}. Score from 1 to 10: likeness (does the head in image 3 look like the child on the sheet), featureMatch (hair colour/style, skin tone, eyes match the card), styleMatch (same art style, line weight, shading as image 2). Report artifacts (visible seams, smudges, wrong anatomy, leftover original face) and extraFaces. overall is 1-10 overall quality. pass is true only if it is usable in print. reason is one short sentence.",
    ),
  styleNotes: z.string().default("soft children's picture-book illustration, clean outlines, warm colours"),
});

export const M1SettingsSchema = z.object({
  version: z.number().int().default(1),
  connection: ConnectionSchema.default(() => ConnectionSchema.parse({})),
  models: ModelsSchema.default(() => ModelsSchema.parse({})),
  generation: GenerationSchema.default(() => GenerationSchema.parse({})),
  masking: MaskingSchema.default(() => MaskingSchema.parse({})),
  qa: QaSchema.default(() => QaSchema.parse({})),
  prompts: PromptsSchema.default(() => PromptsSchema.parse({})),
});

export type M1Settings = z.infer<typeof M1SettingsSchema>;
export type GenerationSettings = z.infer<typeof GenerationSchema>;
export type MaskingSettings = z.infer<typeof MaskingSchema>;
export type QaSettings = z.infer<typeof QaSchema>;

export const SETTINGS_TABS = ["connection", "models", "generation", "masking", "qa", "prompts"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
