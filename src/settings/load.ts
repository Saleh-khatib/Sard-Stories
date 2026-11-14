import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { getDb, type Db } from "../db/client";
import { settingsVersions } from "../db/schema";
import { M1SettingsSchema, type M1Settings } from "./schema";

/** Only used to seed version 1 on a fresh database. */
const SEED_FILE = "settings.m1.json";

async function seedValues(): Promise<unknown> {
  if (existsSync(SEED_FILE)) return JSON.parse(await readFile(SEED_FILE, "utf8"));
  return {};
}

/** The active settings version. Its database id is the settings version recorded with every render. */
export async function loadSettings(db?: Db): Promise<M1Settings> {
  const d = db ?? (await getDb());
  const [row] = await d.select().from(settingsVersions).where(eq(settingsVersions.active, true)).limit(1);
  if (row) return { ...M1SettingsSchema.parse(row.values), version: row.id };
  const values = M1SettingsSchema.parse(await seedValues());
  const [created] = await d.insert(settingsVersions).values({ createdAt: new Date().toISOString(), values, active: true, note: "seeded" }).returning();
  return { ...values, version: (created as { id: number }).id };
}

/** Saving never edits an old version: it adds a new active one, so past renders stay reproducible. */
export async function saveSettings(values: unknown, db?: Db, note?: string): Promise<M1Settings> {
  const d = db ?? (await getDb());
  const parsed = M1SettingsSchema.parse(values);
  await d.update(settingsVersions).set({ active: false }).where(eq(settingsVersions.active, true));
  const [created] = await d.insert(settingsVersions).values({ createdAt: new Date().toISOString(), values: parsed, active: true, note: note ?? null }).returning();
  return { ...parsed, version: (created as { id: number }).id };
}

export async function settingsByVersion(version: number, db?: Db): Promise<M1Settings | null> {
  const d = db ?? (await getDb());
  const [row] = await d.select().from(settingsVersions).where(eq(settingsVersions.id, version)).limit(1);
  return row ? { ...M1SettingsSchema.parse(row.values), version: row.id } : null;
}

export function resolveConnection(s: M1Settings): { project: string; location: string } {
  return {
    project: s.connection.project || process.env.GOOGLE_CLOUD_PROJECT || "",
    location: s.connection.location || process.env.GOOGLE_CLOUD_LOCATION || "global",
  };
}
