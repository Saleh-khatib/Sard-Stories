import { NextResponse } from "next/server";
import { StudioOptionsSchema, MAX_REFS } from "@/pipeline/studio";
import { listBatches, readUpload, startBatch } from "@/server/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE = 40 * 1024 * 1024;
const MAX_FILES = 30;

export async function GET() {
  return NextResponse.json({ batches: await listBatches() });
}

export async function POST(req: Request) {
  const form = await req.formData();
  const opts = StudioOptionsSchema.safeParse(JSON.parse(String(form.get("options") ?? "{}")));
  if (!opts.success) return NextResponse.json({ error: opts.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length > MAX_FILES) return NextResponse.json({ error: `At most ${MAX_FILES} images at a time` }, { status: 400 });
  if (opts.data.mode === "enhance" && files.length === 0) return NextResponse.json({ error: "Add at least one image to enhance" }, { status: 400 });
  if (opts.data.mode === "generate" && !opts.data.prompt.trim()) return NextResponse.json({ error: "Write a prompt first" }, { status: 400 });
  if (opts.data.mode === "generate" && files.length > MAX_REFS) return NextResponse.json({ error: `At most ${MAX_REFS} reference images` }, { status: 400 });

  try {
    const images = await Promise.all(
      files.map(async (f) => {
        if (f.size > MAX_FILE) throw new Error(`${f.name} is larger than 40 MB`);
        return readUpload(f.name, Buffer.from(await f.arrayBuffer()));
      }),
    );
    return NextResponse.json({ batch: await startBatch(opts.data, images) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
