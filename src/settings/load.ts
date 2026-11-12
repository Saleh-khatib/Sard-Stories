import { readFile, writeFile } from "node:fs/promises";
import { M1SettingsSchema, type M1Settings } from "./schema";

export const SETTINGS_FILE = "settings.m1.json";

export async function loadSettings(path = SETTINGS_FILE): Promise<M1Settings> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    return M1SettingsSchema.parse(raw);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return M1SettingsSchema.parse({});
    throw e;
  }
}

export async function saveSettings(settings: unknown, path = SETTINGS_FILE): Promise<M1Settings> {
  const parsed = M1SettingsSchema.parse(settings);
  await writeFile(path, JSON.stringify({ ...parsed, version: parsed.version + 1 }, null, 2) + "\n");
  return { ...parsed, version: parsed.version + 1 };
}

export function resolveConnection(s: M1Settings): { project: string; location: string } {
  return {
    project: s.connection.project || process.env.GOOGLE_CLOUD_PROJECT || "",
    location: s.connection.location || process.env.GOOGLE_CLOUD_LOCATION || "global",
  };
}
