import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { M1Settings } from "../settings/schema";
import { cropInstance } from "./crop";
import { editInstance, type Candidate, type View } from "./edit";
import { makeClient } from "./genai";
import { ChildInfoSchema, SCENE_NAMES, infoPath, inspectInputs, paths, photoPath, type SceneName } from "./inputs";
import { visionJudge, type JudgeResult } from "./judge";
import { cropBinary, extractPng, readMaskBinary } from "./maskops";
import { outlineCrop } from "./outline";
import { composite } from "./composite";
import { edgeSimilarity, outsideMaskDiff, seamDelta, sharpnessRatio } from "./qa";
import { buildCharacterSheet, type FeatureCard } from "./sheet";
import { renderReport } from "./report";

export interface CandidateReport {
  scene: SceneName;
  model: string;
  n: number;
  status: "ok" | "rejected" | "error";
  reason: string | null;
  requestedSize: string | null;
  outputSize: [number, number] | null;
  attempts: Candidate["attempts"];
  aspectErrorPct: number | null;
  seamShift: [number, number, number] | null;
  qa: {
    outsideIdentical: boolean;
    outsideDiffBytes: number;
    edgeSsim: number;
    seamDelta: number;
    seamDeltaBaseline: number;
    sharpnessRatio: number;
    sharpnessBaseline: number;
    vision: JudgeResult | null;
    visionError: string | null;
  } | null;
  verdict: { pass: boolean; reasons: string[] };
  costUsd: number;
  genMs: number;
  files: { raw: string | null; composite: string | null; compositeCrop: string | null };
}

export interface ModelTotals {
  model: string;
  candidates: number;
  passed: number;
  rejected: number;
  errors: number;
  costUsd: number;
  avgInstanceMs: number;
  avg: { edgeSsim: number | null; seamDelta: number | null; sharpnessRatio: number | null; visionOverall: number | null; likeness: number | null; styleMatch: number | null };
}

export interface SceneReport {
  scene: SceneName;
  view: View;
  box: { left: number; top: number; width: number; height: number; ratio: string };
  sceneSize: [number, number];
  files: { original: string; mask: string; crop: string; outlined: string };
  instanceMs: Record<string, number>;
  candidates: CandidateReport[];
}

export interface RunSummary {
  runId: string;
  createdAt: string;
  settingsVersion: number;
  child: { name: string; gender: string };
  models: string[];
  sheet: { file: string; featureCard: FeatureCard; costUsd: number };
  scenes: SceneReport[];
  totals: ModelTotals[];
  totalCostUsd: number;
  thresholds: M1Settings["qa"];
}

export interface RunStatus {
  runId: string;
  state: "running" | "done" | "error";
  startedAt: string;
  total: number;
  done: number;
  current: string;
  error: string | null;
}

export interface RunOptions {
  runId: string;
  scenes: SceneName[];
  models: string[];
  settings: M1Settings;
  outRoot?: string;
  testData?: string;
  photoFile?: string;
  onStatus?: (s: RunStatus) => void;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function judgeVerdict(qa: NonNullable<CandidateReport["qa"]>, t: M1Settings["qa"]): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!qa.outsideIdentical) reasons.push("pixels changed outside the mask");
  if (qa.edgeSsim < t.edgeSsimMin) reasons.push(`structure changed (edge SSIM ${qa.edgeSsim.toFixed(2)} < ${t.edgeSsimMin})`);
  if (qa.seamDelta > t.seamDeltaMax) reasons.push(`visible seam (${qa.seamDelta.toFixed(1)} > ${t.seamDeltaMax})`);
  const rel = qa.sharpnessBaseline > 0 ? qa.sharpnessRatio / qa.sharpnessBaseline : 1;
  if (rel < t.sharpnessRelMin) reasons.push(`soft result (${rel.toFixed(2)}x the original sharpness < ${t.sharpnessRelMin})`);
  if (!qa.vision) reasons.push(`vision judge unavailable${qa.visionError ? `: ${qa.visionError}` : ""}`);
  else {
    if (qa.vision.overall < t.visionScoreMin) reasons.push(`vision score ${qa.vision.overall} < ${t.visionScoreMin}`);
    if (qa.vision.extraFaces) reasons.push("extra faces");
    if (!qa.vision.pass) reasons.push(`judge: ${qa.vision.reason}`);
  }
  return { pass: reasons.length === 0, reasons };
}

export async function runM1(opts: RunOptions): Promise<RunSummary> {
  const outRoot = opts.outRoot ?? "out/m1";
  const testData = opts.testData ?? "test-data";
  const runDir = join(outRoot, opts.runId);
  const { settings } = opts;

  const inputs = await inspectInputs(testData);
  const missing = inputs.problems.filter((p) => opts.scenes.some((s) => p.includes(s)) || p.includes("child"));
  if (missing.length) throw new Error(`Inputs not ready:\n- ${missing.join("\n- ")}`);

  await mkdir(runDir, { recursive: true });
  const status: RunStatus = {
    runId: opts.runId,
    state: "running",
    startedAt: new Date().toISOString(),
    total: opts.scenes.length * opts.models.length * settings.generation.candidates,
    done: 0,
    current: "character sheet",
    error: null,
  };
  const push = async (patch: Partial<RunStatus> = {}) => {
    Object.assign(status, patch);
    await writeFile(join(runDir, "status.json"), JSON.stringify(status, null, 2));
    opts.onStatus?.({ ...status });
  };
  await push();
  await writeFile(join(runDir, "settings.json"), JSON.stringify(settings, null, 2));

  try {
    const client = makeClient(settings);
    const child = ChildInfoSchema.parse(JSON.parse(await readFile(infoPath(testData), "utf8")));
    const photoFile = opts.photoFile ?? photoPath(testData);
    const photo = { data: await readFile(photoFile), mimeType: photoFile.endsWith(".png") ? "image/png" : "image/jpeg" };
    const styleRefs = await Promise.all(opts.scenes.slice(0, 2).map((s) => readFile(paths(testData, s).scene)));

    const sheet = await buildCharacterSheet(client, photo, styleRefs, settings);
    await mkdir(join(runDir, "sheet"), { recursive: true });
    await writeFile(join(runDir, "sheet", "sheet.png"), sheet.sheet.png);
    await writeFile(join(runDir, "sheet", "feature-card.json"), JSON.stringify(sheet.featureCard, null, 2));

    const sceneReports: SceneReport[] = [];
    for (const scene of opts.scenes) {
      const p = paths(testData, scene);
      const [orig, mask] = await Promise.all([readFile(p.scene), readFile(p.mask)]);
      const box = await cropInstance(orig, mask, { paddingPct: settings.masking.cropPaddingPct, maskThreshold: settings.masking.maskThreshold });
      const m = await readMaskBinary(mask, settings.masking.maskThreshold);
      const maskCrop = cropBinary(m.bin, m.width, box);
      const origCrop = await extractPng(orig, box);
      const outlined = await outlineCrop(origCrop, maskCrop, box.width, box.height);
      const sceneDir = join(runDir, scene);
      await mkdir(sceneDir, { recursive: true });
      await copyFile(p.scene, join(sceneDir, "original.png"));
      await copyFile(p.mask, join(sceneDir, "mask.png"));
      await writeFile(join(sceneDir, "crop.png"), origCrop);
      await writeFile(join(sceneDir, "outlined.png"), outlined);
      const meta = await sharp(orig).metadata();
      const sr: SceneReport = {
        scene,
        view: scene,
        box,
        sceneSize: [meta.width ?? 0, meta.height ?? 0],
        files: { original: `${scene}/original.png`, mask: `${scene}/mask.png`, crop: `${scene}/crop.png`, outlined: `${scene}/outlined.png` },
        instanceMs: {},
        candidates: [],
      };

      for (const model of opts.models) {
        await push({ current: `${scene} · ${model}: generating` });
        const ms = { ...settings, models: { ...settings.models, sceneEdit: model } };
        const started = Date.now();
        const cands = await editInstance(
          client,
          { crop: origCrop, outlinedCrop: outlined, sheet: sheet.sheet.png, featureCard: sheet.featureCard, view: scene, box, child },
          ms,
        );
        sr.instanceMs[model] = Date.now() - started;

        for (const c of cands) {
          await push({ current: `${scene} · ${model} #${c.index + 1}: QA` });
          const dir = join(sceneDir, model, String(c.index + 1));
          await mkdir(dir, { recursive: true });
          const rel = (f: string) => `${scene}/${model}/${c.index + 1}/${f}`;
          const rep: CandidateReport = {
            scene, model, n: c.index + 1, status: "ok", reason: null,
            requestedSize: c.attempts.at(-1)?.size ?? null,
            outputSize: c.image ? [c.image.width, c.image.height] : null,
            attempts: c.attempts, aspectErrorPct: null, seamShift: null, qa: null,
            verdict: { pass: false, reasons: [] }, costUsd: c.costUsd, genMs: c.ms,
            files: { raw: null, composite: null, compositeCrop: null },
          };
          if (!c.image) {
            rep.status = "error"; rep.reason = c.error ?? "no image";
            rep.verdict = { pass: false, reasons: [rep.reason] };
          } else {
            await writeFile(join(dir, "raw.png"), c.image.png);
            rep.files.raw = rel("raw.png");
            const comp = await composite(orig, c.image.png, mask, box, ms);
            if (!comp.ok) {
              rep.status = "rejected"; rep.reason = comp.reason;
              rep.verdict = { pass: false, reasons: [comp.reason] };
            } else {
              rep.aspectErrorPct = comp.aspectErrorPct;
              rep.seamShift = comp.seamShift;
              await writeFile(join(dir, "composite.png"), comp.image);
              const compCrop = await extractPng(comp.image, box);
              await writeFile(join(dir, "composite-crop.png"), compCrop);
              rep.files.composite = rel("composite.png");
              rep.files.compositeCrop = rel("composite-crop.png");
              const diff = await outsideMaskDiff(orig, comp.image, mask, settings.masking.maskThreshold);
              let vision: JudgeResult | null = null, visionError: string | null = null, judgeCost = 0;
              try {
                const j = await visionJudge(client, { sheet: sheet.sheet.png, originalCrop: origCrop, editedCrop: compCrop, featureCard: sheet.featureCard, view: scene }, ms);
                vision = j.result; judgeCost = j.costUsd;
              } catch (e) {
                visionError = e instanceof Error ? e.message : String(e);
              }
              rep.costUsd += judgeCost;
              rep.qa = {
                outsideIdentical: diff.identical,
                outsideDiffBytes: diff.differingBytes,
                edgeSsim: await edgeSimilarity(origCrop, compCrop, maskCrop, box.width, box.height, settings.masking),
                seamDelta: await seamDelta(compCrop, maskCrop, box.width, box.height, settings.masking),
                seamDeltaBaseline: await seamDelta(origCrop, maskCrop, box.width, box.height, settings.masking),
                sharpnessRatio: await sharpnessRatio(compCrop, maskCrop, box.width, box.height, settings.masking),
                sharpnessBaseline: await sharpnessRatio(origCrop, maskCrop, box.width, box.height, settings.masking),
                vision, visionError,
              };
              rep.verdict = judgeVerdict(rep.qa, settings.qa);
            }
          }
          await writeFile(join(dir, "report.json"), JSON.stringify(rep, null, 2));
          sr.candidates.push(rep);
          await push({ done: status.done + 1 });
        }
      }
      sceneReports.push(sr);
    }

    const totals: ModelTotals[] = opts.models.map((model) => {
      const cs = sceneReports.flatMap((s) => s.candidates.filter((c) => c.model === model));
      const qa = cs.map((c) => c.qa).filter((q): q is NonNullable<typeof q> => !!q);
      const inst = sceneReports.map((s) => s.instanceMs[model]).filter((x): x is number => x != null);
      const v = qa.map((q) => q.vision).filter((x): x is JudgeResult => !!x);
      return {
        model,
        candidates: cs.length,
        passed: cs.filter((c) => c.verdict.pass).length,
        rejected: cs.filter((c) => c.status === "rejected").length,
        errors: cs.filter((c) => c.status === "error").length,
        costUsd: cs.reduce((a, c) => a + c.costUsd, 0),
        avgInstanceMs: avg(inst) ?? 0,
        avg: {
          edgeSsim: avg(qa.map((q) => q.edgeSsim)),
          seamDelta: avg(qa.map((q) => q.seamDelta)),
          sharpnessRatio: avg(qa.map((q) => q.sharpnessRatio)),
          visionOverall: avg(v.map((x) => x.overall)),
          likeness: avg(v.map((x) => x.likeness)),
          styleMatch: avg(v.map((x) => x.styleMatch)),
        },
      };
    });

    const summary: RunSummary = {
      runId: opts.runId,
      createdAt: status.startedAt,
      settingsVersion: settings.version,
      child,
      models: opts.models,
      sheet: { file: "sheet/sheet.png", featureCard: sheet.featureCard, costUsd: sheet.costUsd },
      scenes: sceneReports,
      totals,
      totalCostUsd: sheet.costUsd + totals.reduce((a, t) => a + t.costUsd, 0),
      thresholds: settings.qa,
    };
    await writeFile(join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
    await writeFile(join(runDir, "report.html"), renderReport(summary, ""));
    await writeFile(join(outRoot, "report.html"), renderReport(summary, `${opts.runId}/`));
    await push({ state: "done", current: "finished" });
    return summary;
  } catch (e) {
    await push({ state: "error", error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export { SCENE_NAMES };
