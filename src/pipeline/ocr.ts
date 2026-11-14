import type { GoogleGenAI } from "@google/genai";
import type { M1Settings } from "../settings/schema";
import { generateJson, imagePart } from "./genai";

export interface OcrRead {
  model: string;
  text: string;
  costUsd: number;
  error: string | null;
}

export function normalizeText(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Letter for letter, digit for digit, including capitalisation. Only whitespace is forgiven. */
export function exactMatch(read: string, expected: string): boolean {
  return normalizeText(read) === normalizeText(expected);
}

/** Expands name tokens: {hero} is the name, {HERO} is the name in capitals. */
export function expandTemplate(template: string, names: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => {
    const lower = k.toLowerCase();
    const name = names[lower];
    if (name === undefined) return m;
    return k === k.toUpperCase() ? name.toUpperCase() : name;
  });
}

/** Reads the art text with every OCR model in Settings. The words only pass if every read matches exactly. */
export async function readArtText(
  client: GoogleGenAI,
  settings: M1Settings,
  png: Buffer,
  expected: string,
): Promise<{ exact: boolean; reads: OcrRead[]; costUsd: number }> {
  const reads = await Promise.all(
    settings.models.ocr.map(async (model): Promise<OcrRead> => {
      try {
        const r = await generateJson<{ text: string }>(client, settings, {
          model,
          parts: [imagePart(png), { text: settings.prompts.ocr }],
          schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        });
        return { model, text: r.value.text ?? "", costUsd: r.costUsd, error: null };
      } catch (e) {
        return { model, text: "", costUsd: 0, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  return {
    exact: reads.length > 0 && reads.every((r) => !r.error && exactMatch(r.text, expected)),
    reads,
    costUsd: reads.reduce((a, r) => a + r.costUsd, 0),
  };
}
