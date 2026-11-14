import type { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { limiter } from "../src/pipeline/studio";
import type { InstanceCtx, Recorder, RenderRecord } from "../src/pipeline/render";
import { M1SettingsSchema, type M1Settings } from "../src/settings/schema";

export interface Call { kind: "image" | "judge" | "ocr" | "card"; model: string; prompt: string }

export interface Behavior {
  /** Called for each judge request, in order; return false to give a failing score. */
  judgePass: (n: number) => boolean;
  /** Called per OCR request (n counts all OCR calls); return the text the model "reads". */
  ocrText: (n: number, model: string) => string;
}

const usage = { promptTokenCount: 200, candidatesTokenCount: 1120, candidatesTokensDetails: [{ modality: "IMAGE", tokenCount: 1120 }] };

export async function fakeClient(b: Partial<Behavior> = {}): Promise<{ client: GoogleGenAI; calls: Call[] }> {
  const cache = new Map<string, string>();
  const pngFor = async (ratio: string): Promise<string> => {
    const hit = cache.get(ratio);
    if (hit) return hit;
    const [a = 1, c = 1] = ratio.split(":").map(Number);
    const long = 1024;
    const [w, h] = a >= c ? [long, Math.round((long * c) / a)] : [Math.round((long * a) / c), long];
    const data = (await sharp({ create: { width: w, height: h, channels: 3, background: "#3366cc" } }).png().toBuffer()).toString("base64");
    cache.set(ratio, data);
    return data;
  };
  const calls: Call[] = [];
  let judgeN = 0, ocrN = 0;
  const behavior: Behavior = { judgePass: () => true, ocrText: () => "OMAR 10", ...b };
  const client = {
    models: {
      generateContent: async (req: { model: string; contents: { parts: { text?: string }[] }[]; config: { responseJsonSchema?: { properties?: Record<string, unknown> }; imageConfig?: { aspectRatio?: string } } }) => {
        const prompt = req.contents[0]?.parts.map((p) => p.text ?? "").join("\n") ?? "";
        const props = Object.keys(req.config.responseJsonSchema?.properties ?? {});
        if (props.includes("likeness")) {
          calls.push({ kind: "judge", model: req.model, prompt });
          const ok = behavior.judgePass(judgeN++);
          const text = JSON.stringify({ likeness: ok ? 9 : 3, featureMatch: 9, styleMatch: 9, overall: ok ? 9 : 3, artifacts: [], extraFaces: false, pass: ok, reason: ok ? "good" : "looks wrong" });
          return { text, usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 80 } };
        }
        if (props.length === 1 && props[0] === "text") {
          calls.push({ kind: "ocr", model: req.model, prompt });
          return { text: JSON.stringify({ text: behavior.ocrText(ocrN++, req.model) }), usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 20 } };
        }
        if (props.includes("hairColor")) {
          calls.push({ kind: "card", model: req.model, prompt });
          return { text: JSON.stringify({ hairColor: "black", hairStyle: "short", skinTone: "olive", eyes: "brown", notableFeatures: [] }), usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 40 } };
        }
        calls.push({ kind: "image", model: req.model, prompt });
        return { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: await pngFor(req.config.imageConfig?.aspectRatio ?? "1:1") } }] } }], usageMetadata: usage };
      },
    },
  } as unknown as GoogleGenAI;
  return { client, calls };
}

/** Settings with the image-metric thresholds opened up, so tests exercise retry/flag/OCR logic and not pixel statistics. */
export function testSettings(over: { candidates?: number; maxAutoRetries?: number } = {}): M1Settings {
  const s = M1SettingsSchema.parse({});
  return {
    ...s,
    version: 7,
    generation: { ...s.generation, candidates: over.candidates ?? 2 },
    qa: { ...s.qa, edgeSsimMin: -1, seamDeltaMax: 1e6, sharpnessRatioMin: 0, maxAutoRetries: over.maxAutoRetries ?? 1 },
  };
}

export function memRecorder(): Recorder & { records: RenderRecord[]; selected: number[] } {
  const records: RenderRecord[] = [];
  const selected: number[] = [];
  return {
    records,
    selected,
    async record(r) { records.push(r); return records.length; },
    async select(id) { selected.push(id); },
  };
}

export async function ctxFor(settings: M1Settings, client: GoogleGenAI, recorder: Recorder, sheet: Buffer): Promise<Omit<InstanceCtx, "original">> {
  return {
    client,
    settings,
    schedule: limiter(4),
    sheets: { child: sheet, teen: sheet, adult: sheet },
    featureCard: { hairColor: "black", hairStyle: "short", skinTone: "olive", eyes: "brown", notableFeatures: [] },
    child: { name: "Omar", gender: "boy" },
    recorder,
    outDir: null,
  };
}
