import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { resampleMask } from "@/pipeline/enhance";
import { SCENE_NAMES, paths } from "@/pipeline/inputs";
import { loadSettings } from "@/settings/load";
import { readBatch, STUDIO_ROOT } from "@/server/studio";

export const runtime = "nodejs";

const Body = z.object({ batchId: z.string().regex(/^[\w.-]+$/), jobId: z.string().regex(/^[\w.-]+$/), n: z.number().int().min(1), scene: z.enum(SCENE_NAMES) });

/** Puts a chosen version in as a scene. The old scene and mask are backed up; the mask is resampled to the new size. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { batchId, jobId, n, scene } = parsed.data;
  const batch = await readBatch(batchId);
  const job = batch?.jobs.find((j) => j.id === jobId);
  const v = job?.versions.find((x) => x.n === n);
  if (!batch || !v?.file || !v.width || !v.height) return NextResponse.json({ error: "Version not found" }, { status: 404 });

  const settings = await loadSettings();
  if ((v.aspectErrorPct ?? 0) > settings.enhance.maxAspectErrorPct) {
    return NextResponse.json({ error: `This version's proportions differ from the original by ${v.aspectErrorPct?.toFixed(1)}%, more than the allowed ${settings.enhance.maxAspectErrorPct}%, so the mask would not line up.` }, { status: 422 });
  }

  const p = paths("test-data", scene);
  const backup = join("out/backup", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(backup, { recursive: true });
  const notes: string[] = [];
  if (existsSync(p.scene)) { await copyFile(p.scene, join(backup, `${scene}.png`)); notes.push(`old scene backed up to ${backup}`); }
  await writeFile(p.scene, await readFile(join(STUDIO_ROOT, v.file)));
  if (existsSync(p.mask)) {
    await copyFile(p.mask, join(backup, `${scene}-mask.png`));
    await writeFile(p.mask, await resampleMask(await readFile(join(backup, `${scene}-mask.png`)), v.width, v.height));
    notes.push(`mask resampled to ${v.width}x${v.height} (old mask backed up)`);
  } else notes.push("no mask existed for this scene");
  const meta = await sharp(p.scene).metadata();
  return NextResponse.json({ ok: true, size: [meta.width, meta.height], notes });
}
