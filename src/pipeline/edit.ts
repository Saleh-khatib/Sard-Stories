import type { GoogleGenAI } from "@google/genai";
import type { M1Settings, OutputSize } from "../settings/schema";
import type { CropBox } from "./crop";
import { fillTemplate, fitInline, generateImage, imagePart, type GeneratedImage } from "./genai";
import { chooseOutputSize, nextSize } from "./size";
import { featureVars, type FeatureCard } from "./sheet";

export type View = "front" | "side" | "back";

export interface Attempt {
  size: OutputSize;
  width: number;
  height: number;
  accepted: boolean;
  costUsd: number;
  ms: number;
}

export interface Candidate {
  index: number;
  image: GeneratedImage | null;
  attempts: Attempt[];
  costUsd: number;
  ms: number;
  error: string | null;
}

export function promptFor(view: View, settings: M1Settings): string {
  return { front: settings.prompts.sceneEditFront, side: settings.prompts.sceneEditSide, back: settings.prompts.sceneEditBack }[view];
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i] as T, i);
      }
    }),
  );
  return results;
}

/**
 * N parallel candidates. If the model returns less than the crop (for example a 1K answer to a
 * 2K request), the call is repeated at the next size up; output is never enlarged.
 */
export async function editInstance(
  client: GoogleGenAI,
  input: {
    crop: Buffer;
    outlinedCrop: Buffer;
    sheet: Buffer;
    featureCard: FeatureCard;
    view: View;
    box: CropBox;
    child: { name: string; gender: string };
  },
  settings: M1Settings,
): Promise<Candidate[]> {
  const max = settings.generation.maxInlineBytes;
  const [crop, outlined, sheet] = await Promise.all([
    fitInline(input.crop, max),
    fitInline(input.outlinedCrop, max),
    fitInline(input.sheet, max),
  ]);
  const prompt = fillTemplate(promptFor(input.view, settings), {
    ...featureVars(input.featureCard, settings),
    name: input.child.name,
    gender: input.child.gender,
    view: input.view,
  });
  const model = settings.models.sceneEdit;
  const indices = Array.from({ length: settings.generation.candidates }, (_, i) => i);

  return mapPool(indices, settings.generation.concurrency, async (index): Promise<Candidate> => {
    const started = Date.now();
    const attempts: Attempt[] = [];
    let size: OutputSize | null = chooseOutputSize(input.box.width, input.box.height, settings.generation);
    let image: GeneratedImage | null = null;
    let cost = 0;
    let error: string | null = null;
    try {
      while (size) {
        const seed = settings.generation.seed == null ? null : settings.generation.seed + index;
        const img = await generateImage(client, settings, {
          model,
          parts: [imagePart(crop), imagePart(outlined), imagePart(sheet), { text: prompt }],
          size,
          aspectRatio: input.box.ratio,
          seed,
        });
        cost += img.costUsd;
        const big = img.width >= input.box.width && img.height >= input.box.height;
        attempts.push({ size, width: img.width, height: img.height, accepted: big, costUsd: img.costUsd, ms: img.ms });
        image = img;
        if (big) break;
        size = nextSize(size);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    return { index, image, attempts, costUsd: cost, ms: Date.now() - started, error };
  });
}
