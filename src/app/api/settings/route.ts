import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { loadSettings, saveSettings } from "@/settings/load";
import { M1SettingsSchema } from "@/settings/schema";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ settings: await loadSettings(), defaults: M1SettingsSchema.parse({}) });
}

export async function PUT(req: Request) {
  try {
    return NextResponse.json({ settings: await saveSettings(await req.json(), undefined, "saved from Settings") });
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
    }
    throw e;
  }
}
