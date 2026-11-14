import { NextResponse } from "next/server";
import { readStatus, readSummary } from "@/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[\w.-]+$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const status = await readStatus(id);
  if (!status) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ status, summary: status.state === "done" ? await readSummary(id) : null });
}
