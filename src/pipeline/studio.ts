import type { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { z } from "zod";
import { OutputSizeSchema, type M1Settings } from "../settings/schema";
import { SUPPORTED_RATIOS } from "./crop";
import { nearestRatio } from "./enhance";
import { fitInline, generateImage, generateJson, imagePart } from "./genai";
import { edgeSimilarity } from "./qa";

export const RATIO_LABELS: string[] = SUPPORTED_RATIOS.map((r) => r.label);
export const MAX_REFS = 14;

export const StudioOptionsSchema = z.object({
  mode: z.enum(["enhance", "generate"]),
  model: z.string().min(1),
  ratio: z.string().refine((r) => r === "auto" || RATIO_LABELS.includes(r), "unsupported aspect ratio").default("auto"),
  size: OutputSizeSchema,
  versions: z.number().int().min(1).max(4),
  prompt: z.string().max(4000).default(""),
  improvePrompt: z.boolean().default(false),
});
export type StudioOptions = z.infer<typeof StudioOptionsSchema>;

export interface StudioRef {
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

export interface StudioVersion {
  n: number;
  png: Buffer | null;
  width: number | null;
  height: number | null;
  costUsd: number;
  ms: number;
  structureMatch: number | null;
  sharpnessGain: number | null;
  aspectErrorPct: number | null;
  warnings: string[];
  error: string | null;
}

export type Schedule = <T>(fn: () => Promise<T>) => Promise<T>;

export function limiter(max: number): Schedule {
  let active = 0;
  const queue: (() => void)[] = [];
  return <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(() => {
          active--;
          queue.shift()?.();
        });
      };
      if (active < max) run();
      else queue.push(run);
    });
}

async function laplacianVariance(png: Buffer, side: number): Promise<number> {
  const { data, info } = await sharp(png).flatten({ background: "#ffffff" }).greyscale().resize(side, side, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < info.height - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * (data[i] as number) - (data[i - 1] as number) - (data[i + 1] as number) - (data[i - w] as number) - (data[i + w] as number);
      sum += l; sum2 += l * l; n++;
    }
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

async function compareToInput(ref: StudioRef, out: Buffer, w: number, h: number) {
  const inputAtOutput = await sharp(ref.data).removeAlpha().resize(w, h, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
  const all = new Uint8Array(512 * 512).fill(1);
  const a = await sharp(inputAtOutput).resize(512, 512, { fit: "fill" }).png().toBuffer();
  const b = await sharp(out).resize(512, 512, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
  const structureMatch = await edgeSimilarity(a, b, all, 512, 512, { qaMaxSidePx: 512 });
  const [vi, vo] = await Promise.all([laplacianVariance(inputAtOutput, 1024), laplacianVariance(out, 1024)]);
  return { structureMatch, sharpnessGain: vi > 0 ? vo / vi : null };
}

export async function improvePrompt(client: GoogleGenAI, settings: M1Settings, prompt: string): Promise<{ prompt: string; costUsd: number }> {
  const r = await generateJson<{ prompt: string }>(client, settings, {
    model: settings.models.featureCard,
    parts: [{ text: `${settings.prompts.improvePrompt}\n\nUser idea: ${prompt}` }],
    schema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
  });
  return { prompt: r.value.prompt || prompt, costUsd: r.costUsd };
}

export function buildPrompt(opts: StudioOptions, settings: M1Settings): string {
  if (opts.mode === "generate") return opts.prompt.trim();
  const extra = opts.prompt.trim();
  return extra ? `${settings.prompts.enhance}\n\nAdditional instructions: ${extra}` : settings.prompts.enhance;
}

/** One job = one prompt with N versions. Enhance jobs take one image; generate jobs take 0 to 14 reference images. */
export async function runStudioJob(
  client: GoogleGenAI,
  settings: M1Settings,
  opts: StudioOptions,
  refs: StudioRef[],
  schedule: Schedule,
  onVersion: (v: StudioVersion) => void | Promise<void>,
  only?: number[],
): Promise<{ finalPrompt: string; promptCostUsd: number }> {
  if (opts.mode === "generate" && !opts.prompt.trim()) throw new Error("Write a prompt first");
  if (opts.mode === "enhance" && refs.length === 0) throw new Error("Add an image to enhance");
  if (refs.length > MAX_REFS) throw new Error(`At most ${MAX_REFS} reference images`);

  let finalPrompt = buildPrompt(opts, settings);
  let promptCostUsd = 0;
  if (opts.improvePrompt && opts.mode === "generate") {
    const r = await improvePrompt(client, settings, finalPrompt);
    finalPrompt = r.prompt;
    promptCostUsd = r.costUsd;
  }

  const first = refs[0];
  const near = first ? nearestRatio(first.width, first.height) : null;
  const aspect = opts.ratio !== "auto" ? opts.ratio : (near?.label ?? "1:1");
  const sendRefs = await Promise.all(
    refs.map(async (r) => (r.data.length > settings.generation.maxInlineBytes ? { data: await fitInline(await sharp(r.data).png({ compressionLevel: 9 }).toBuffer(), settings.generation.maxInlineBytes), mimeType: "image/png" } : { data: r.data, mimeType: r.mimeType })),
  );
  const s = { ...settings, generation: { ...settings.generation, temperature: opts.mode === "enhance" ? settings.enhance.temperature : settings.generation.temperature } };

  await Promise.all(
    Array.from({ length: opts.versions }, async (_, i) => {
      if (only && !only.includes(i + 1)) return;
      const v: StudioVersion = { n: i + 1, png: null, width: null, height: null, costUsd: 0, ms: 0, structureMatch: null, sharpnessGain: null, aspectErrorPct: null, warnings: [], error: null };
      try {
        const img = await schedule(() =>
          generateImage(client, s, {
            model: opts.model,
            parts: [...sendRefs.map((r) => imagePart(r.data, r.mimeType)), { text: finalPrompt }],
            size: opts.size,
            aspectRatio: aspect,
            seed: settings.generation.seed == null ? null : settings.generation.seed + i,
          }),
        );
        Object.assign(v, { png: img.png, width: img.width, height: img.height, costUsd: img.costUsd, ms: img.ms });
        if (first) {
          v.aspectErrorPct = Math.abs(img.width / img.height / (first.width / first.height) - 1) * 100;
          if (opts.mode === "enhance") {
            const c = await compareToInput(first, img.png, img.width, img.height);
            v.structureMatch = c.structureMatch;
            v.sharpnessGain = c.sharpnessGain;
            if (c.structureMatch < 0.5) v.warnings.push(`structure match is low (${c.structureMatch.toFixed(2)}): the picture may have changed`);
            if (img.width < first.width || img.height < first.height) v.warnings.push(`output ${img.width}x${img.height} is smaller than the input ${first.width}x${first.height}`);
            if (v.aspectErrorPct > settings.enhance.maxAspectErrorPct) v.warnings.push(`proportions differ from the input by ${v.aspectErrorPct.toFixed(1)}%`);
          }
        }
      } catch (e) {
        v.error = e instanceof Error ? e.message : String(e);
      }
      await onVersion(v);
    }),
  );
  return { finalPrompt, promptCostUsd };
}
