import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import sharp from "sharp";
import { makeClient } from "../pipeline/genai";
import { limiter, runStudioJob, StudioOptionsSchema, type Schedule, type StudioOptions, type StudioRef, type StudioVersion } from "../pipeline/studio";
import { loadSettings } from "../settings/load";

export const STUDIO_ROOT = "out/studio";
const PRESETS_FILE = "storage/studio-presets.json";

export interface VersionRec {
  n: number;
  file: string | null;
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

export interface JobRec {
  id: string;
  name: string;
  refs: string[];
  refSizes: [number, number][];
  state: "queued" | "running" | "done" | "error";
  finalPrompt: string;
  versions: VersionRec[];
  selected: number | null;
  error: string | null;
}

export interface BatchRec {
  id: string;
  createdAt: string;
  options: StudioOptions;
  state: "running" | "done";
  jobs: JobRec[];
  totalCostUsd: number;
}

const writeChains = new Map<string, Promise<void>>();
async function save(batch: BatchRec): Promise<void> {
  const prev = writeChains.get(batch.id) ?? Promise.resolve();
  const next = prev.then(() => writeFile(join(STUDIO_ROOT, batch.id, "batch.json"), JSON.stringify(batch, null, 2)));
  writeChains.set(batch.id, next.catch(() => undefined));
  await next;
}

export async function readBatch(id: string): Promise<BatchRec | null> {
  try {
    return JSON.parse(await readFile(join(STUDIO_ROOT, id, "batch.json"), "utf8")) as BatchRec;
  } catch {
    return null;
  }
}

export async function listBatches(): Promise<BatchRec[]> {
  if (!existsSync(STUDIO_ROOT)) return [];
  const dirs = (await readdir(STUDIO_ROOT, { withFileTypes: true })).filter((d) => d.isDirectory());
  const all = await Promise.all(dirs.map((d) => readBatch(d.name)));
  return all.filter((b): b is BatchRec => !!b).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function setSelected(id: string, jobId: string, n: number | null): Promise<BatchRec | null> {
  const batch = await readBatch(id);
  const job = batch?.jobs.find((j) => j.id === jobId);
  if (!batch || !job) return null;
  if (n !== null && !job.versions.some((v) => v.n === n && v.file)) return null;
  job.selected = n;
  await save(batch);
  return batch;
}

export interface UploadedImage {
  name: string;
  data: Buffer;
  format: "png" | "jpg" | "webp";
  width: number;
  height: number;
}

export async function readUpload(name: string, data: Buffer): Promise<UploadedImage> {
  const meta = await sharp(data).metadata();
  const format = meta.format === "jpeg" ? "jpg" : meta.format;
  if ((format !== "png" && format !== "jpg" && format !== "webp") || !meta.width || !meta.height) {
    throw new Error(`${name}: use a PNG, JPG or WebP image`);
  }
  return { name, data, format, width: meta.width, height: meta.height };
}

const MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;

/** Creates the batch on disk and starts running it in the background. Returns immediately. */
export async function startBatch(options: StudioOptions, images: UploadedImage[]): Promise<BatchRec> {
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(STUDIO_ROOT, id);
  await mkdir(dir, { recursive: true });

  const groups: UploadedImage[][] = options.mode === "enhance" ? images.map((i) => [i]) : [images];
  const jobs: JobRec[] = [];
  for (const [i, group] of groups.entries()) {
    const jobId = `j${i + 1}`;
    await mkdir(join(dir, jobId), { recursive: true });
    const refs: string[] = [];
    for (const [k, img] of group.entries()) {
      const file = `${jobId}/ref-${k + 1}.${img.format}`;
      await writeFile(join(dir, file), img.data);
      refs.push(`${id}/${file}`);
    }
    jobs.push({
      id: jobId,
      name: options.mode === "enhance" ? (group[0]?.name ?? jobId) : options.prompt.trim().slice(0, 60) || "Generation",
      refs,
      refSizes: group.map((g) => [g.width, g.height]),
      state: "queued",
      finalPrompt: "",
      versions: [],
      selected: null,
      error: null,
    });
  }
  const batch: BatchRec = { id, createdAt: new Date().toISOString(), options, state: "running", jobs, totalCostUsd: 0 };
  await save(batch);
  void run(batch, groups).catch((e) => console.error(`studio batch ${id} failed:`, e));
  return batch;
}

const g = globalThis as unknown as { __studioLimit?: { max: number; run: Schedule } };
/** One limiter for the whole process, so several batches together stay under the API quota. */
function sharedLimiter(max: number): Schedule {
  if (!g.__studioLimit || g.__studioLimit.max !== max) g.__studioLimit = { max, run: limiter(max) };
  return g.__studioLimit.run;
}

async function runJob(batch: BatchRec, job: JobRec, refs: StudioRef[], only?: number[]): Promise<void> {
  const settings = await loadSettings();
  const schedule = sharedLimiter(settings.generation.concurrency);
  job.state = "running";
  job.error = null;
  await save(batch);
  try {
    const client = makeClient(settings);
    const r = await runStudioJob(
      client,
      settings,
      batch.options,
      refs,
      schedule,
      async (v: StudioVersion) => {
        const rec: VersionRec = { n: v.n, file: null, width: v.width, height: v.height, costUsd: v.costUsd, ms: v.ms, structureMatch: v.structureMatch, sharpnessGain: v.sharpnessGain, aspectErrorPct: v.aspectErrorPct, warnings: v.warnings, error: v.error };
        if (v.png) {
          const name = `${job.id}/v${v.n}.png`;
          await writeFile(join(STUDIO_ROOT, batch.id, name), v.png);
          rec.file = `${batch.id}/${name}`;
        }
        job.versions = [...job.versions.filter((x) => x.n !== v.n), rec].sort((a, b) => a.n - b.n);
        batch.totalCostUsd += v.costUsd;
        await save(batch);
      },
      only,
    );
    job.finalPrompt = r.finalPrompt;
    batch.totalCostUsd += r.promptCostUsd;
    job.state = "done";
    const ok = job.versions.filter((v) => v.file);
    if (ok.length === 1 && job.selected === null && batch.options.versions === 1) job.selected = (ok[0] as VersionRec).n;
  } catch (e) {
    job.state = "error";
    job.error = e instanceof Error ? e.message : String(e);
  }
  await save(batch);
}

async function run(batch: BatchRec, groups: UploadedImage[][]): Promise<void> {
  await Promise.all(
    batch.jobs.map((job, idx) =>
      runJob(batch, job, (groups[idx] ?? []).map((g2) => ({ data: g2.data, mimeType: MIME[g2.format], width: g2.width, height: g2.height }))),
    ),
  );
  batch.state = "done";
  await save(batch);
}

/** Regenerates only the versions of a job that failed (for example after a rate limit). */
export async function retryFailed(id: string, jobId: string): Promise<BatchRec | null> {
  const batch = await readBatch(id);
  const job = batch?.jobs.find((j) => j.id === jobId);
  if (!batch || !job) return null;
  const failed: number[] = [];
  for (let n = 1; n <= batch.options.versions; n++) {
    const v = job.versions.find((x) => x.n === n);
    if (!v || !v.file) failed.push(n);
  }
  if (failed.length === 0) return batch;
  const refs: StudioRef[] = [];
  for (const f of job.refs) {
    const data = await readFile(join(STUDIO_ROOT, f));
    const meta = await sharp(data).metadata();
    const format = meta.format === "jpeg" ? "jpg" : (meta.format as "png" | "jpg" | "webp");
    refs.push({ data, mimeType: MIME[format], width: meta.width ?? 0, height: meta.height ?? 0 });
  }
  batch.state = "running";
  await save(batch);
  void runJob(batch, job, refs, failed)
    .then(async () => { batch.state = "done"; await save(batch); })
    .catch((e) => console.error(`retry ${id}/${jobId} failed:`, e));
  return batch;
}

export const PresetSchema = z.object({ id: z.string(), name: z.string().min(1).max(60), options: StudioOptionsSchema, createdAt: z.string() });
export type Preset = z.infer<typeof PresetSchema>;

export async function readPresets(): Promise<Preset[]> {
  try {
    return z.array(PresetSchema).parse(JSON.parse(await readFile(PRESETS_FILE, "utf8")));
  } catch {
    return [];
  }
}

export async function writePresets(presets: Preset[]): Promise<void> {
  await mkdir("storage", { recursive: true });
  await writeFile(PRESETS_FILE, JSON.stringify(presets, null, 2));
}
