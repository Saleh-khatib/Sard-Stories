import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = ["out/m1", "test-data/scenes", "test-data/masks"];
const TYPES: Record<string, string> = { png: "image/png", json: "application/json", html: "text/html; charset=utf-8" };

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const rel = normalize(path.join("/"));
  const ok = ALLOWED.some((root) => rel === root || rel.startsWith(root + sep));
  if (!ok || rel.includes("..")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const data = await readFile(join(process.cwd(), rel));
    const ext = rel.split(".").pop() ?? "";
    return new NextResponse(new Uint8Array(data), {
      headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
