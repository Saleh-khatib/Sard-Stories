import sharp from "sharp";
import { composite } from "./composite";
import { readMaskBinary, readRaw } from "./maskops";
import { outsideMaskDiff } from "./qa";
import { processInstance, type InstanceCtx, type InstanceDef, type InstanceResult } from "./render";

export interface SceneDef {
  id: string;
  original: Buffer;
  instances: InstanceDef[];
  /** Real people who must never change: no edit mask may touch these. */
  fixedMasks: { id: string; mask: Buffer }[];
}

export interface SceneOutcome {
  sceneId: string;
  status: "done" | "flagged";
  image: Buffer;
  results: InstanceResult[];
  flagged: { instanceId: string; reason: string }[];
  costUsd: number;
  outsideUnionIdentical: boolean;
}

function overlaps(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] && b[i]) n++;
  return n;
}

async function unionPng(bins: Uint8Array[], width: number, height: number): Promise<Buffer> {
  const out = Buffer.alloc(width * height);
  for (const b of bins) for (let i = 0; i < out.length; i++) if (b[i]) out[i] = 255;
  return sharp(out, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

/**
 * Runs every instance of one scene. Each instance crops from the untouched original; passing results are then
 * pasted one by one through their own masks, so a collage can never change anything between its panels.
 */
export async function runScene(ctx: Omit<InstanceCtx, "original">, scene: SceneDef): Promise<SceneOutcome> {
  const thr = ctx.settings.masking.maskThreshold;
  const meta = await sharp(scene.original).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;

  const bins = new Map<string, Uint8Array>();
  for (const inst of scene.instances) {
    const m = await readMaskBinary(inst.mask, thr);
    if (m.width !== W || m.height !== H) throw new Error(`Mask of ${inst.id} is ${m.width}x${m.height}, scene is ${W}x${H}`);
    bins.set(inst.id, m.bin);
  }
  const fixed = await Promise.all(scene.fixedMasks.map(async (f) => ({ id: f.id, bin: (await readMaskBinary(f.mask, thr)).bin })));

  const flagged: { instanceId: string; reason: string }[] = [];
  const runnable: InstanceDef[] = [];
  for (const [i, inst] of scene.instances.entries()) {
    const bin = bins.get(inst.id) as Uint8Array;
    const hitFixed = fixed.find((f) => overlaps(bin, f.bin) > 0);
    const hitOther = scene.instances.slice(0, i).find((o) => overlaps(bin, bins.get(o.id) as Uint8Array) > 0);
    if (hitFixed) flagged.push({ instanceId: inst.id, reason: `mask overlaps fixed person "${hitFixed.id}"` });
    else if (hitOther) flagged.push({ instanceId: inst.id, reason: `mask overlaps instance "${hitOther.id}"` });
    else runnable.push(inst);
  }

  const results = await Promise.all(runnable.map((inst) => processInstance({ ...ctx, original: scene.original }, inst)));

  let running = scene.original;
  const applied: Uint8Array[] = [];
  for (const inst of runnable) {
    const r = results.find((x) => x.instanceId === inst.id) as InstanceResult;
    if (r.status === "flagged" || !r.chosen) {
      flagged.push({ instanceId: inst.id, reason: r.reasons.join("; ") || "failed QA" });
      continue;
    }
    const comp = await composite(running, r.chosen.output, inst.mask, r.chosen.box, ctx.settings);
    if (!comp.ok) {
      flagged.push({ instanceId: inst.id, reason: comp.reason });
      continue;
    }
    running = comp.image;
    applied.push(bins.get(inst.id) as Uint8Array);
  }

  const union = await unionPng(applied, W, H);
  const diff = await outsideMaskDiff(scene.original, running, union, thr);
  if (!diff.identical) throw new Error(`Pixels changed outside the edit masks (${diff.differingBytes} bytes). This must never happen.`);

  const raw = await readRaw(running);
  if (raw.width !== W || raw.height !== H) throw new Error("Result size differs from the original");

  return {
    sceneId: scene.id,
    status: flagged.length ? "flagged" : "done",
    image: running,
    results,
    flagged,
    costUsd: results.reduce((a, r) => a + r.costUsd, 0),
    outsideUnionIdentical: diff.identical,
  };
}
