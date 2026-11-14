import { NextResponse } from "next/server";
import { z } from "zod";
import { StudioOptionsSchema } from "@/pipeline/studio";
import { readPresets, writePresets } from "@/server/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ presets: await readPresets() });
}

const Save = z.object({ name: z.string().trim().min(1).max(60), options: StudioOptionsSchema });

/** Saves a preset; saving under an existing name replaces it. */
export async function POST(req: Request) {
  const body = Save.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  const presets = await readPresets();
  const existing = presets.find((p) => p.name.toLowerCase() === body.data.name.toLowerCase());
  const preset = { id: existing?.id ?? crypto.randomUUID(), name: body.data.name, options: body.data.options, createdAt: existing?.createdAt ?? new Date().toISOString() };
  await writePresets([...presets.filter((p) => p.id !== preset.id), preset].sort((a, b) => a.name.localeCompare(b.name)));
  return NextResponse.json({ presets: await readPresets(), saved: preset });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const presets = await readPresets();
  await writePresets(presets.filter((p) => p.id !== id));
  return NextResponse.json({ presets: await readPresets() });
}
