import type { GoogleGenAI } from "@google/genai";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgeStage, View } from "../db/schema";
import type { M1Settings } from "../settings/schema";
import { generateCandidates, type CandidateGen } from "./candidates";
import { composite } from "./composite";
import { cropInstance, type CropBox } from "./crop";
import { promptFor } from "./edit";
import { fillTemplate, imagePart } from "./genai";
import { visionJudge } from "./judge";
import { binaryBBox, cropBinary, extractPng, readMaskBinary } from "./maskops";
import { expandTemplate, readArtText } from "./ocr";
import { outlineCrop } from "./outline";
import { edgeSimilarity, outsideMaskDiff, seamDelta, sharpnessRatio } from "./qa";
import { featureVars, type FeatureCard } from "./sheet";
import type { Schedule } from "./studio";
import { verdictFor, type QaScores, type Verdict } from "./verdict";

export interface RenderRecord {
  instanceId: string;
  version: number;
  candidate: number;
  status: "ok" | "failed_qa" | "rejected" | "error";
  qaScores: QaScores | null;
  qaReason: string | null;
  outputSize: string | null;
  outputPath: string | null;
  compositePath: string | null;
  costUsd: number;
  ms: number;
  selected: boolean;
  inputs: Record<string, unknown>;
  promptVersion: string;
  settingsVersion: number;
}

export interface Recorder {
  record(r: RenderRecord): Promise<number>;
  select(renderId: number): Promise<void>;
}

export interface InstanceDef {
  id: string;
  kind: "character" | "art_text";
  view: View;
  ageStage: AgeStage;
  mask: Buffer;
  originalWords?: string;
  newWordsTemplate?: string;
}

export interface InstanceCtx {
  client: GoogleGenAI;
  settings: M1Settings;
  schedule: Schedule;
  original: Buffer;
  sheets: Partial<Record<AgeStage, Buffer>>;
  featureCard: FeatureCard;
  child: { name: string; gender: string };
  recorder: Recorder;
  /** When set, raw outputs and composite crops of every candidate are written here for inspection. */
  outDir: string | null;
}

export interface Picked {
  renderId: number;
  version: number;
  candidate: number;
  output: Buffer;
  box: CropBox;
  verdict: Verdict;
  compositeCropPath: string | null;
}

export interface InstanceResult {
  instanceId: string;
  status: "passed" | "flagged";
  rounds: number;
  attempts: number;
  costUsd: number;
  chosen: Picked | null;
  bestFailed: Picked | null;
  reasons: string[];
  expectedText: string | null;
}

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex").slice(0, 12);

export function expectedWords(inst: InstanceDef, child: { name: string }): string | null {
  return inst.kind === "art_text" && inst.newWordsTemplate ? expandTemplate(inst.newWordsTemplate, { hero: child.name }) : null;
}

function buildPrompt(inst: InstanceDef, ctx: InstanceCtx, expected: string | null, hint: string): string {
  const p = ctx.settings.prompts;
  if (inst.kind === "art_text") {
    return fillTemplate(p.artText, { old_words: inst.originalWords ?? "", new_words: expected ?? "" }) + hint;
  }
  const vars = { ...featureVars(ctx.featureCard, ctx.settings), name: ctx.child.name, gender: ctx.child.gender, view: inst.view };
  return `${fillTemplate(promptFor(inst.view, ctx.settings), vars)}\n${p.ageStageLine[inst.ageStage]}${hint}`;
}

interface Evaluated {
  gen: CandidateGen;
  status: RenderRecord["status"];
  verdict: Verdict;
  qa: QaScores | null;
  compositeCrop: Buffer | null;
  costUsd: number;
}

/**
 * One instance: N candidates per round, QA on each, a new round (a new version) with the failure reasons as a
 * hint when none passes, and a flag after the last round. Every candidate is recorded.
 */
export async function processInstance(ctx: InstanceCtx, inst: InstanceDef): Promise<InstanceResult> {
  const { settings } = ctx;
  const m = await readMaskBinary(inst.mask, settings.masking.maskThreshold);
  const box = await cropInstance(ctx.original, inst.mask, { paddingPct: settings.masking.cropPaddingPct, maskThreshold: settings.masking.maskThreshold });
  const maskCrop = cropBinary(m.bin, m.width, box);
  const maskBox = binaryBBox(m.bin, m.width, m.height) as NonNullable<ReturnType<typeof binaryBBox>>;
  const origCrop = await extractPng(ctx.original, box);
  const outlined = await outlineCrop(origCrop, maskCrop, box.width, box.height);
  const sheet = ctx.sheets[inst.ageStage] ?? ctx.sheets.child;
  if (inst.kind === "character" && !sheet) throw new Error(`No character sheet for age stage "${inst.ageStage}"`);
  const expected = expectedWords(inst, ctx.child);
  if (inst.kind === "art_text" && !expected) throw new Error(`Art text instance ${inst.id} has no new-words template`);

  const rounds = 1 + settings.qa.maxAutoRetries;
  let cost = 0;
  let hint = "";
  let attempts = 0;
  const failed: { pick: Picked; reasons: string[] }[] = [];

  for (let version = 1; version <= rounds; version++) {
    const prompt = buildPrompt(inst, ctx, expected, hint);
    const parts = [imagePart(origCrop), imagePart(outlined), ...(inst.kind === "character" && sheet ? [imagePart(sheet)] : []), { text: prompt }];
    const gens = await generateCandidates(ctx.client, settings, {
      model: settings.models.sceneEdit,
      parts,
      box,
      count: settings.generation.candidates,
      seedBase: settings.generation.seed == null ? null : settings.generation.seed + version * 100,
      schedule: ctx.schedule,
    });

    const evaluated = await Promise.all(
      gens.map(async (gen): Promise<Evaluated> => {
        if (!gen.image) {
          const reason = gen.error ?? "no image returned";
          return { gen, status: "error", verdict: { pass: false, reasons: [reason], score: -1 }, qa: null, compositeCrop: null, costUsd: gen.costUsd };
        }
        const comp = await composite(ctx.original, gen.image.png, inst.mask, box, settings);
        if (!comp.ok) return { gen, status: "rejected", verdict: { pass: false, reasons: [comp.reason], score: -1 }, qa: null, compositeCrop: null, costUsd: gen.costUsd };
        const compCrop = await extractPng(comp.image, box);
        const diff = await outsideMaskDiff(ctx.original, comp.image, inst.mask, settings.masking.maskThreshold);
        let extra = 0;
        let vision: QaScores["vision"] = null;
        let visionError: string | null = null;
        let ocr: QaScores["ocr"] = null;
        if (inst.kind === "character") {
          try {
            const j = await ctx.schedule(() => visionJudge(ctx.client, { sheet: sheet as Buffer, originalCrop: origCrop, editedCrop: compCrop, featureCard: ctx.featureCard, view: inst.view }, settings));
            vision = j.result;
            extra += j.costUsd;
          } catch (e) {
            visionError = e instanceof Error ? e.message : String(e);
          }
        } else {
          const padX = Math.round(maskBox.width * 0.25), padY = Math.round(maskBox.height * 0.25);
          const left = Math.max(0, maskBox.left - padX), top = Math.max(0, maskBox.top - padY);
          const textBox = { left, top, width: Math.min(m.width - left, maskBox.width + 2 * padX), height: Math.min(m.height - top, maskBox.height + 2 * padY) };
          const textCrop = await extractPng(comp.image, textBox);
          const read = await ctx.schedule(() => readArtText(ctx.client, settings, textCrop, expected as string));
          ocr = { expected: expected as string, exact: read.exact, reads: read.reads.map((r) => ({ model: r.model, text: r.text, error: r.error })) };
          extra += read.costUsd;
        }
        const qa: QaScores = {
          outsideIdentical: diff.identical,
          outsideDiffBytes: diff.differingBytes,
          edgeSsim: await edgeSimilarity(origCrop, compCrop, maskCrop, box.width, box.height, settings.masking),
          seamDelta: await seamDelta(compCrop, maskCrop, box.width, box.height, settings.masking),
          sharpnessRatio: await sharpnessRatio(compCrop, maskCrop, box.width, box.height, settings.masking),
          vision,
          visionError,
          ocr,
        };
        const verdict = verdictFor(inst.kind, qa, settings.qa);
        return { gen, status: verdict.pass ? "ok" : "failed_qa", verdict, qa, compositeCrop: compCrop, costUsd: gen.costUsd + extra };
      }),
    );

    const roundPicks: { ev: Evaluated; renderId: number; pick: Picked }[] = [];
    for (const ev of evaluated) {
      attempts++;
      cost += ev.costUsd;
      let outputPath: string | null = null;
      let compositePath: string | null = null;
      if (ctx.outDir && ev.gen.image) {
        const dir = join(ctx.outDir, inst.id, `v${version}-c${ev.gen.index + 1}`);
        await mkdir(dir, { recursive: true });
        outputPath = join(dir, "raw.png");
        await writeFile(outputPath, ev.gen.image.png);
        if (ev.compositeCrop) {
          compositePath = join(dir, "composite-crop.png");
          await writeFile(compositePath, ev.compositeCrop);
        }
      }
      const renderId = await ctx.recorder.record({
        instanceId: inst.id,
        version,
        candidate: ev.gen.index + 1,
        status: ev.status,
        qaScores: ev.qa,
        qaReason: ev.verdict.reasons.join("; ") || null,
        outputSize: ev.gen.image ? `${ev.gen.image.width}x${ev.gen.image.height}` : null,
        outputPath,
        compositePath,
        costUsd: ev.costUsd,
        ms: ev.gen.ms,
        selected: false,
        inputs: { kind: inst.kind, view: inst.view, ageStage: inst.ageStage, model: settings.models.sceneEdit, requestedSize: ev.gen.attempts.at(-1)?.size ?? null, cropBox: box, cropSha: sha(origCrop), sheetSha: sheet ? sha(sheet) : null, promptSha: sha(prompt), prompt, attempts: ev.gen.attempts, expectedText: expected },
        promptVersion: `${settings.version}:${sha(prompt)}`,
        settingsVersion: settings.version,
      });
      if (ev.gen.image) {
        roundPicks.push({ ev, renderId, pick: { renderId, version, candidate: ev.gen.index + 1, output: ev.gen.image.png, box, verdict: ev.verdict, compositeCropPath: compositePath } });
      }
    }

    const passing = roundPicks.filter((r) => r.ev.verdict.pass).sort((a, b) => b.ev.verdict.score - a.ev.verdict.score);
    if (passing[0]) {
      await ctx.recorder.select(passing[0].renderId);
      return { instanceId: inst.id, status: "passed", rounds: version, attempts, costUsd: cost, chosen: passing[0].pick, bestFailed: null, reasons: [], expectedText: expected };
    }
    for (const r of roundPicks) failed.push({ pick: r.pick, reasons: r.ev.verdict.reasons });
    const problems = [...new Set(evaluated.flatMap((e) => e.verdict.reasons))].slice(0, 4).join("; ");
    hint = problems ? `\n${fillTemplate(settings.prompts.retryHint, { problems })}` : "";
  }

  const best = failed.sort((a, b) => b.pick.verdict.score - a.pick.verdict.score)[0];
  return {
    instanceId: inst.id,
    status: "flagged",
    rounds,
    attempts,
    costUsd: cost,
    chosen: null,
    bestFailed: best?.pick ?? null,
    reasons: best?.reasons ?? ["no candidate produced an image"],
    expectedText: expected,
  };
}
