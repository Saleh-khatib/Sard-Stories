import { NextResponse } from "next/server";
import { z } from "zod";
import { SCENE_NAMES, inspectInputs } from "@/pipeline/inputs";
import { runM1 } from "@/pipeline/runM1";
import { loadSettings } from "@/settings/load";
import { getActive, setActive } from "@/server/runs";

export const runtime = "nodejs";

const Body = z.object({
  scenes: z.array(z.enum(SCENE_NAMES)).min(1),
  models: z.array(z.string().min(1)).min(1),
  candidates: z.number().int().min(1).max(4).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  if (getActive()) return NextResponse.json({ error: [`Run ${getActive()} is still running`] }, { status: 409 });
  const inputs = await inspectInputs();
  const problems = inputs.problems.filter((p) => parsed.data.scenes.some((s) => p.includes(s)) || p.includes("child"));
  if (problems.length) return NextResponse.json({ error: problems }, { status: 422 });

  const settings = await loadSettings();
  if (parsed.data.candidates) settings.generation.candidates = parsed.data.candidates;
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  setActive(runId);
  void runM1({ runId, scenes: parsed.data.scenes, models: parsed.data.models, settings })
    .catch((e) => console.error(`run ${runId} failed:`, e instanceof Error ? e.message : e))
    .finally(() => setActive(null));
  return NextResponse.json({ runId });
}
