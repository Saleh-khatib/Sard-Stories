import type { GoogleGenAI } from "@google/genai";
import { and, eq, inArray } from "drizzle-orm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "../db/client";
import { dbRecorder } from "../db/recorder";
import { AGE_STAGES, childProfiles, instances, orderScenes, orders, sceneRenders, sceneResults, scenes, type AgeStage, type InstanceKind, type SheetRef, type View } from "../db/schema";
import { buildAgeSheet } from "../pipeline/agesheet";
import type { InstanceDef } from "../pipeline/render";
import { runScene, type SceneOutcome } from "../pipeline/scene";
import { buildCharacterSheet, type FeatureCard } from "../pipeline/sheet";
import { limiter, type Schedule } from "../pipeline/studio";
import type { M1Settings } from "../settings/schema";

export const STORAGE_ROOT = process.env.STORAGE_ROOT ?? "storage";

export interface SceneInput {
  id: string;
  name: string;
  originalPath: string;
  width: number;
  height: number;
  instances: {
    id: string;
    kind: InstanceKind;
    view?: View;
    ageStage?: AgeStage;
    slotKey?: string;
    maskPath: string;
    originalWords?: string;
    newWordsTemplate?: string;
  }[];
}

export async function importScene(db: Db, input: SceneInput): Promise<void> {
  await db.insert(scenes).values({ id: input.id, name: input.name, originalPath: input.originalPath, width: input.width, height: input.height, createdAt: new Date().toISOString() }).onConflictDoUpdate({ target: scenes.id, set: { name: input.name, originalPath: input.originalPath, width: input.width, height: input.height } });
  // Instances are updated in place: recorded renders point at them, and history is never deleted.
  for (const [i, inst] of input.instances.entries()) {
    const row = { sceneId: input.id, kind: inst.kind, slotKey: inst.slotKey ?? "hero", ageStage: inst.ageStage ?? "child", view: inst.view ?? "front", maskPath: inst.maskPath, originalWords: inst.originalWords ?? null, newWordsTemplate: inst.newWordsTemplate ?? null, sortOrder: i };
    await db.insert(instances).values({ id: inst.id, ...row }).onConflictDoUpdate({ target: instances.id, set: row });
  }
  const keep = new Set(input.instances.map((i) => i.id));
  for (const old of await db.select().from(instances).where(eq(instances.sceneId, input.id))) {
    if (keep.has(old.id)) continue;
    const used = await db.select({ id: sceneRenders.id }).from(sceneRenders).where(eq(sceneRenders.instanceId, old.id)).limit(1);
    if (used.length === 0) await db.delete(instances).where(eq(instances.id, old.id));
  }
}

export async function createOrder(db: Db, a: { id: string; name: string; settingsVersion: number; sceneIds: string[]; child: { name: string; gender: "boy" | "girl"; photoPath: string; slotKey?: string } }): Promise<void> {
  await db.insert(orders).values({ id: a.id, name: a.name, status: "draft", settingsVersion: a.settingsVersion, createdAt: new Date().toISOString() });
  for (const sceneId of a.sceneIds) await db.insert(orderScenes).values({ orderId: a.id, sceneId });
  await db.insert(childProfiles).values({ id: `${a.id}-${a.child.slotKey ?? "hero"}`, orderId: a.id, slotKey: a.child.slotKey ?? "hero", name: a.child.name, gender: a.child.gender, photoPath: a.child.photoPath, sheets: {} });
}

async function orderScenesRows(db: Db, orderId: string) {
  const links = await db.select().from(orderScenes).where(eq(orderScenes.orderId, orderId));
  return links.length ? db.select().from(scenes).where(inArray(scenes.id, links.map((l) => l.sceneId))) : [];
}

/** Total cost of everything the order has spent so far: sheets plus every recorded render. */
export async function orderCost(db: Db, orderId: string): Promise<number> {
  const renders = await db.select({ c: sceneRenders.costUsd }).from(sceneRenders).where(eq(sceneRenders.orderId, orderId));
  const profiles = await db.select().from(childProfiles).where(eq(childProfiles.orderId, orderId));
  const sheetCost = profiles.flatMap((p) => Object.values(p.sheets ?? {})).reduce((a, s) => a + (s?.costUsd ?? 0), 0);
  return renders.reduce((a, r) => a + r.c, 0) + sheetCost;
}

async function refreshOrder(db: Db, orderId: string): Promise<void> {
  const rows = await orderScenesRows(db, orderId);
  const results = await db.select().from(sceneResults).where(eq(sceneResults.orderId, orderId));
  const latest = new Map<string, (typeof results)[number]>();
  for (const r of results) latest.set(r.sceneId, r);
  const all = rows.every((s) => latest.has(s.id));
  const status = !all ? "running" : [...latest.values()].some((r) => r.status === "error") ? "error" : [...latest.values()].some((r) => r.status === "flagged") ? "flagged" : "done";
  await db.update(orders).set({ status, actualCost: await orderCost(db, orderId) }).where(eq(orders.id, orderId));
}

const sheetPath = (orderId: string, stage: AgeStage, root = STORAGE_ROOT) => join(root, "orders", orderId, "sheets", `${stage}.png`);

/**
 * Character sheet and feature card from the photo, then the other age stages the order's scenes need.
 * Sheets start unapproved: the operator gate (M4) flips that. Unattended runs pass `autoApprove`.
 */
export async function ensureSheets(a: { db: Db; client: GoogleGenAI; settings: M1Settings; orderId: string; autoApprove?: boolean; schedule?: Schedule; root?: string }): Promise<void> {
  const { db, client, settings, orderId } = a;
  const schedule = a.schedule ?? limiter(settings.generation.concurrency);
  const [profile] = await db.select().from(childProfiles).where(eq(childProfiles.orderId, orderId)).limit(1);
  if (!profile) throw new Error(`Order ${orderId} has no child profile`);
  const sceneRows = await orderScenesRows(db, orderId);
  const inst = sceneRows.length ? await db.select().from(instances).where(inArray(instances.sceneId, sceneRows.map((s) => s.id))) : [];
  const needed = new Set<AgeStage>(["child", ...inst.filter((i) => i.kind === "character").map((i) => i.ageStage)]);
  const sheets: Partial<Record<AgeStage, SheetRef>> = { ...profile.sheets };
  let card = profile.featureCard as FeatureCard | null;
  const root = a.root ?? STORAGE_ROOT;

  if (!sheets.child) {
    const photo = await readFile(profile.photoPath);
    const refs = await Promise.all(sceneRows.slice(0, 2).map((s) => readFile(s.originalPath)));
    const built = await buildCharacterSheet(client, { data: photo, mimeType: profile.photoPath.endsWith(".png") ? "image/png" : "image/jpeg" }, refs, settings);
    card = built.featureCard;
    const p = sheetPath(orderId, "child", root);
    await mkdir(join(root, "orders", orderId, "sheets"), { recursive: true });
    await writeFile(p, built.sheet.png);
    sheets.child = { path: p, approved: !!a.autoApprove, costUsd: built.costUsd };
  }
  if (!card) throw new Error("Feature card missing");
  const base = await readFile((sheets.child as SheetRef).path);
  for (const stage of AGE_STAGES) {
    if (!needed.has(stage) || sheets[stage]) continue;
    const img = await buildAgeSheet(client, settings, base, card, stage, schedule);
    const p = sheetPath(orderId, stage, root);
    await writeFile(p, img.png);
    sheets[stage] = { path: p, approved: !!a.autoApprove, costUsd: img.costUsd };
  }
  await db.update(childProfiles).set({ sheets, featureCard: card as unknown as Record<string, unknown> }).where(eq(childProfiles.id, profile.id));
  await db.update(orders).set({ status: "running", actualCost: await orderCost(db, orderId) }).where(eq(orders.id, orderId));
}

/** Runs one scene of an order: loads its instances, runs the pipeline, stores the result and updates the order. */
export async function runSceneForOrder(a: { db: Db; client: GoogleGenAI; settings: M1Settings; orderId: string; sceneId: string; schedule?: Schedule; root?: string; outDir?: string | null }): Promise<SceneOutcome> {
  const { db, client, settings, orderId, sceneId } = a;
  const root = a.root ?? STORAGE_ROOT;
  const [profile] = await db.select().from(childProfiles).where(eq(childProfiles.orderId, orderId)).limit(1);
  const [scene] = await db.select().from(scenes).where(eq(scenes.id, sceneId)).limit(1);
  if (!profile || !scene) throw new Error("Order or scene not found");
  const sheetRefs = profile.sheets ?? {};
  if (!sheetRefs.child) throw new Error("Character sheet not built yet");
  const unapproved = Object.entries(sheetRefs).filter(([, s]) => !s?.approved).map(([k]) => k);
  if (unapproved.length) throw new Error(`Character sheet not approved (${unapproved.join(", ")}): the operator must approve it before generation`);

  const sheets: Partial<Record<AgeStage, Buffer>> = {};
  for (const stage of AGE_STAGES) if (sheetRefs[stage]) sheets[stage] = await readFile((sheetRefs[stage] as SheetRef).path);
  const rows = await db.select().from(instances).where(and(eq(instances.sceneId, sceneId))).orderBy(instances.sortOrder);
  const defs: InstanceDef[] = [];
  const fixedMasks: { id: string; mask: Buffer }[] = [];
  for (const r of rows) {
    const mask = await readFile(r.maskPath);
    if (r.kind === "fixed_person") fixedMasks.push({ id: r.id, mask });
    else defs.push({ id: r.id, kind: r.kind === "art_text" ? "art_text" : "character", view: r.view, ageStage: r.ageStage, mask, originalWords: r.originalWords ?? undefined, newWordsTemplate: r.newWordsTemplate ?? undefined });
  }

  const outcome = await runScene(
    { client, settings, schedule: a.schedule ?? limiter(settings.generation.concurrency), sheets, featureCard: profile.featureCard as unknown as FeatureCard, child: { name: profile.name, gender: profile.gender }, recorder: dbRecorder(db, orderId), outDir: a.outDir ?? null },
    { id: sceneId, original: await readFile(scene.originalPath), instances: defs, fixedMasks },
  );

  const dir = join(root, "orders", orderId, "scenes");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${sceneId}.png`);
  await writeFile(path, outcome.image);
  await db.insert(sceneResults).values({ orderId, sceneId, status: outcome.status === "done" ? "done" : "flagged", path, flaggedInstances: outcome.flagged, costUsd: outcome.costUsd, outsideUnionIdentical: outcome.outsideUnionIdentical, createdAt: new Date().toISOString() });
  await refreshOrder(db, orderId);
  return outcome;
}

export async function markSceneError(db: Db, orderId: string, sceneId: string, message: string): Promise<void> {
  await db.insert(sceneResults).values({ orderId, sceneId, status: "error", path: null, flaggedInstances: [{ instanceId: "*", reason: message }], costUsd: 0, outsideUnionIdentical: null, createdAt: new Date().toISOString() });
  await refreshOrder(db, orderId);
}
