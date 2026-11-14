import { NextResponse } from "next/server";
import sharp from "sharp";
import { loadSettings } from "@/settings/load";
import { generateImage, generateJson, imagePart, makeClient } from "@/pipeline/genai";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  const settings = await loadSettings();
  const results: { model: string; kind: string; ok: boolean; detail: string; ms: number; costUsd: number }[] = [];
  try {
    const client = makeClient(settings);
    const img = await sharp({ create: { width: 256, height: 256, channels: 3, background: "#f4efe6" } })
      .composite([{ input: Buffer.from('<svg width="256" height="256"><circle cx="128" cy="128" r="60" fill="#d33"/></svg>') }])
      .png()
      .toBuffer();
    const fail = (model: string, kind: string, e: unknown, t: number) =>
      results.push({ model, kind, ok: false, detail: (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 200), ms: Date.now() - t, costUsd: 0 });
    for (const model of new Set([settings.models.visionJudge, settings.models.featureCard])) {
      const t = Date.now();
      try {
        const r = await generateJson<{ ok: boolean }>(client, settings, {
          model, parts: [imagePart(img), { text: 'Reply with JSON {"ok": true}' }],
          schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
        });
        results.push({ model, kind: "text+vision", ok: true, detail: "ok", ms: r.ms, costUsd: r.costUsd });
      } catch (e) {
        fail(model, "text+vision", e, t);
      }
    }
    for (const model of new Set([...settings.models.compare, settings.models.sceneEdit, settings.models.characterSheet])) {
      const t = Date.now();
      try {
        const r = await generateImage(client, settings, {
          model, size: "1K", aspectRatio: "1:1",
          parts: [imagePart(img), { text: "Change the red circle to blue. Keep everything else identical." }],
        });
        results.push({ model, kind: "image", ok: true, detail: `${r.width}x${r.height} ${r.modelMime}`, ms: r.ms, costUsd: r.costUsd });
      } catch (e) {
        fail(model, "image", e, t);
      }
    }
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), results }, { status: 500 });
  }
}
