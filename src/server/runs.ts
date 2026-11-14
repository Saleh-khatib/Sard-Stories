import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { RunStatus, RunSummary } from "../pipeline/runM1";

export const OUT_ROOT = "out/m1";

const g = globalThis as unknown as { __m1Active?: string | null };
export const getActive = () => g.__m1Active ?? null;
export const setActive = (id: string | null) => {
  g.__m1Active = id;
};

export async function readStatus(id: string): Promise<RunStatus | null> {
  try {
    return JSON.parse(await readFile(join(OUT_ROOT, id, "status.json"), "utf8")) as RunStatus;
  } catch {
    return null;
  }
}

export async function readSummary(id: string): Promise<RunSummary | null> {
  try {
    return JSON.parse(await readFile(join(OUT_ROOT, id, "summary.json"), "utf8")) as RunSummary;
  } catch {
    return null;
  }
}

export async function listRuns(): Promise<RunStatus[]> {
  if (!existsSync(OUT_ROOT)) return [];
  const names = await readdir(OUT_ROOT, { withFileTypes: true });
  const runs = await Promise.all(names.filter((d) => d.isDirectory()).map((d) => readStatus(d.name)));
  return runs.filter((r): r is RunStatus => !!r).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function credentialSource(): string {
  const f = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (f && existsSync(f)) return "service-account file (GOOGLE_APPLICATION_CREDENTIALS)";
  const home = process.env.HOME ?? "";
  if (existsSync(join(home, ".config/gcloud/application_default_credentials.json"))) return "gcloud application-default login";
  return "none found";
}
