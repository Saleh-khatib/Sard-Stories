import { NextResponse } from "next/server";
import { z } from "zod";
import { readBatch, retryFailed, setSelected } from "@/server/studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[\w.-]+$/;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const batch = ID.test(id) ? await readBatch(id) : null;
  return batch ? NextResponse.json({ batch }) : NextResponse.json({ error: "not found" }, { status: 404 });
}

const Select = z.object({ jobId: z.string().regex(ID), n: z.number().int().min(1).nullable().optional(), retry: z.boolean().optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = Select.safeParse(await req.json());
  if (!body.success || !ID.test(id)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (body.data.retry) {
    const r = await retryFailed(id, body.data.jobId);
    return r ? NextResponse.json({ batch: r }) : NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const batch = await setSelected(id, body.data.jobId, body.data.n ?? null);
  return batch ? NextResponse.json({ batch }) : NextResponse.json({ error: "Version not found" }, { status: 404 });
}
