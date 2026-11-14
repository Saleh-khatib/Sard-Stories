import type { GoogleGenAI, Part } from "@google/genai";
import type { M1Settings, OutputSize } from "../settings/schema";
import type { CropBox } from "./crop";
import type { Attempt } from "./edit";
import { generateImage, type GeneratedImage } from "./genai";
import { chooseOutputSize, nextSize } from "./size";
import type { Schedule } from "./studio";

export interface CandidateGen {
  index: number;
  image: GeneratedImage | null;
  attempts: Attempt[];
  costUsd: number;
  ms: number;
  error: string | null;
}

/**
 * N parallel candidates for one crop. If a model returns less than the crop, the call is repeated at the
 * next size up. Output is only ever scaled down later, never enlarged.
 */
export async function generateCandidates(
  client: GoogleGenAI,
  settings: M1Settings,
  a: { model: string; parts: Part[]; box: CropBox; count: number; seedBase: number | null; schedule: Schedule },
): Promise<CandidateGen[]> {
  return Promise.all(
    Array.from({ length: a.count }, async (_, index): Promise<CandidateGen> => {
      const started = Date.now();
      const attempts: Attempt[] = [];
      let size: OutputSize | null = chooseOutputSize(a.box.width, a.box.height, settings.generation);
      let image: GeneratedImage | null = null;
      let cost = 0;
      let error: string | null = null;
      try {
        while (size) {
          const current: OutputSize = size;
          const img = await a.schedule(() =>
            generateImage(client, settings, { model: a.model, parts: a.parts, size: current, aspectRatio: a.box.ratio, seed: a.seedBase == null ? null : a.seedBase + index }),
          );
          cost += img.costUsd;
          const big = img.width >= a.box.width && img.height >= a.box.height;
          attempts.push({ size: current, width: img.width, height: img.height, accepted: big, costUsd: img.costUsd, ms: img.ms });
          image = img;
          if (big) break;
          size = nextSize(current);
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      return { index, image, attempts, costUsd: cost, ms: Date.now() - started, error };
    }),
  );
}
