import { NextResponse } from "next/server";
import { loadSettings, resolveConnection } from "@/settings/load";
import { credentialSource } from "@/server/runs";

export const runtime = "nodejs";

export async function GET() {
  const c = resolveConnection(await loadSettings());
  return NextResponse.json({ ...c, credentials: credentialSource() });
}
