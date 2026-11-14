import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;
export const DEFAULT_DB_URL = "file:storage/app.sqlite";

const g = globalThis as unknown as { __db?: { url: string; db: Db; client: Client } };

export function openDb(url = process.env.DATABASE_URL ?? DEFAULT_DB_URL): { db: Db; client: Client } {
  if (url.startsWith("file:")) mkdirSync(dirname(url.slice(5)), { recursive: true });
  const client = createClient({ url });
  return { db: drizzle(client, { schema }), client };
}

/** Shared connection for the app and workers; tests open their own in-memory database. */
export async function getDb(): Promise<Db> {
  const url = process.env.DATABASE_URL ?? DEFAULT_DB_URL;
  if (!g.__db || g.__db.url !== url) {
    const { db, client } = openDb(url);
    await migrate(db, { migrationsFolder: "drizzle" });
    g.__db = { url, db, client };
  }
  return g.__db.db;
}

export async function openMemoryDb(): Promise<Db> {
  const { db } = openDb(":memory:");
  await migrate(db, { migrationsFolder: "drizzle" });
  return db;
}
