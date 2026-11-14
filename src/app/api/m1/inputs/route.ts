import { NextResponse } from "next/server";
import { inspectInputs } from "@/pipeline/inputs";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await inspectInputs());
}
