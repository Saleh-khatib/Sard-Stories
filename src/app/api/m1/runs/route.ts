import { NextResponse } from "next/server";
import { getActive, listRuns } from "@/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ runs: await listRuns(), active: getActive() });
}
