import { GoogleGenAI, type Part } from "@google/genai";
import sharp from "sharp";
import { resolveConnection } from "../settings/load";
import type { M1Settings, OutputSize } from "../settings/schema";

export function makeClient(settings: M1Settings): GoogleGenAI {
  const { project, location } = resolveConnection(settings);
  if (!project) throw new Error("No Google Cloud project set (Settings > Connection, or GOOGLE_CLOUD_PROJECT)");
  return new GoogleGenAI({ vertexai: true, project, location });
}

export interface Usage {
  inputTokens: number;
  outputImageTokens: number;
  outputTextTokens: number;
}

export interface GeneratedImage {
  png: Buffer;
  modelMime: string;
  width: number;
  height: number;
  requestedSize: OutputSize | null;
  usage: Usage;
  costUsd: number;
  ms: number;
}

export const imagePart = (data: Buffer, mimeType = "image/png"): Part => ({
  inlineData: { mimeType, data: data.toString("base64") },
});

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** Shrinks only reference inputs that exceed the inline limit; never used on pipeline outputs. */
export async function fitInline(png: Buffer, maxBytes: number): Promise<Buffer> {
  let out = png;
  let scale = 1;
  const meta = await sharp(png).metadata();
  while (out.length > maxBytes && scale > 0.1) {
    scale *= 0.8;
    out = await sharp(png)
      .resize(Math.round((meta.width ?? 1) * scale), Math.round((meta.height ?? 1) * scale), { kernel: "lanczos3" })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }
  return out;
}

export function computeCost(settings: M1Settings, model: string, u: Usage): number {
  const p = settings.models.prices[model];
  if (!p) return 0;
  return (u.inputTokens * p.inputPerM + u.outputImageTokens * p.outputImagePerM + u.outputTextTokens * p.outputTextPerM) / 1e6;
}

type UsageMeta = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  candidatesTokensDetails?: { modality?: string; tokenCount?: number }[];
};

export function readUsage(meta: UsageMeta | undefined): Usage {
  const total = meta?.candidatesTokenCount ?? 0;
  const image = (meta?.candidatesTokensDetails ?? [])
    .filter((d) => String(d.modality).toUpperCase() === "IMAGE")
    .reduce((s, d) => s + (d.tokenCount ?? 0), 0);
  return {
    inputTokens: meta?.promptTokenCount ?? 0,
    outputImageTokens: image,
    outputTextTokens: Math.max(0, total - image) + (meta?.thoughtsTokenCount ?? 0),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(settings: M1Settings, fn: () => Promise<T>): Promise<T> {
  const { maxTries, baseDelayMs } = settings.generation.retry;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = (e as { status?: number; code?: number }).status ?? (e as { code?: number }).code ?? 0;
      const retryable = status === 429 || status >= 500;
      if (!retryable || attempt >= maxTries) throw e;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
}

export async function generateImage(
  client: GoogleGenAI,
  settings: M1Settings,
  args: { model: string; parts: Part[]; size: OutputSize | null; aspectRatio: string; seed?: number | null },
): Promise<GeneratedImage> {
  const g = settings.generation;
  const started = Date.now();
  const res = await withRetry(settings, () =>
    client.models.generateContent({
      model: args.model,
      contents: [{ role: "user", parts: args.parts }],
      config: {
        responseModalities: ["IMAGE"],
        temperature: g.temperature,
        topP: g.topP,
        ...(args.seed != null ? { seed: args.seed } : {}),
        imageConfig: {
          aspectRatio: args.aspectRatio,
          ...(args.size ? { imageSize: args.size } : {}),
          personGeneration: g.personGeneration,
          outputMimeType: "image/png",
        },
      },
    }),
  );
  const cand = res.candidates?.[0];
  const part = cand?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) {
    const text = cand?.content?.parts?.map((p) => p.text).filter(Boolean).join(" ");
    throw new Error(
      `No image returned (finishReason=${cand?.finishReason ?? "none"}, block=${res.promptFeedback?.blockReason ?? "none"}${text ? `, text="${text.slice(0, 200)}"` : ""})`,
    );
  }
  const modelMime = part.inlineData.mimeType ?? "image/png";
  let png = Buffer.from(part.inlineData.data, "base64");
  if (modelMime !== "image/png") png = await sharp(png).png({ compressionLevel: 9 }).toBuffer();
  const meta = await sharp(png).metadata();
  const usage = readUsage(res.usageMetadata as UsageMeta | undefined);
  return {
    png,
    modelMime,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    requestedSize: args.size,
    usage,
    costUsd: computeCost(settings, args.model, usage),
    ms: Date.now() - started,
  };
}

export async function generateJson<T>(
  client: GoogleGenAI,
  settings: M1Settings,
  args: { model: string; parts: Part[]; schema: Record<string, unknown> },
): Promise<{ value: T; usage: Usage; costUsd: number; ms: number }> {
  const started = Date.now();
  const res = await withRetry(settings, () =>
    client.models.generateContent({
      model: args.model,
      contents: [{ role: "user", parts: args.parts }],
      config: {
        temperature: 0,
        responseMimeType: "application/json",
        responseJsonSchema: args.schema,
      },
    }),
  );
  const text = res.text;
  if (!text) throw new Error("Empty JSON response");
  const usage = readUsage(res.usageMetadata as UsageMeta | undefined);
  return { value: JSON.parse(text) as T, usage, costUsd: computeCost(settings, args.model, usage), ms: Date.now() - started };
}
