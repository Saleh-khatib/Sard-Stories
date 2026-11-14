import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const INSTANCE_KINDS = ["character", "art_text", "fixed_person"] as const;
export const AGE_STAGES = ["child", "teen", "adult"] as const;
export const VIEWS = ["front", "side", "back"] as const;
export type InstanceKind = (typeof INSTANCE_KINDS)[number];
export type AgeStage = (typeof AGE_STAGES)[number];
export type View = (typeof VIEWS)[number];

export const settingsVersions = sqliteTable("settings_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: text("created_at").notNull(),
  values: text("values", { mode: "json" }).$type<unknown>().notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(false),
  note: text("note"),
});

export const scenes = sqliteTable("scenes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  originalPath: text("original_path").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  createdAt: text("created_at").notNull(),
});

export const instances = sqliteTable("instances", {
  id: text("id").primaryKey(),
  sceneId: text("scene_id").notNull().references(() => scenes.id),
  kind: text("kind").$type<InstanceKind>().notNull(),
  slotKey: text("slot_key").notNull().default("hero"),
  ageStage: text("age_stage").$type<AgeStage>().notNull().default("child"),
  view: text("view").$type<View>().notNull().default("front"),
  maskPath: text("mask_path").notNull(),
  originalWords: text("original_words"),
  newWordsTemplate: text("new_words_template"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").$type<"draft" | "running" | "done" | "flagged" | "error">().notNull().default("draft"),
  settingsVersion: integer("settings_version").notNull(),
  estCost: real("est_cost").notNull().default(0),
  actualCost: real("actual_cost").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export interface SheetRef {
  path: string;
  approved: boolean;
  costUsd: number;
}

export const childProfiles = sqliteTable("child_profiles", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id),
  slotKey: text("slot_key").notNull().default("hero"),
  name: text("name").notNull(),
  gender: text("gender").$type<"boy" | "girl">().notNull(),
  photoPath: text("photo_path").notNull(),
  featureCard: text("feature_card", { mode: "json" }).$type<Record<string, unknown>>(),
  sheets: text("sheets", { mode: "json" }).$type<Partial<Record<AgeStage, SheetRef>>>().notNull().default({}),
});

/** One row per generated candidate. Nothing is ever overwritten: a retry or regenerate is a new version. */
export const sceneRenders = sqliteTable("scene_renders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: text("order_id").notNull().references(() => orders.id),
  instanceId: text("instance_id").notNull().references(() => instances.id),
  version: integer("version").notNull(),
  candidate: integer("candidate").notNull(),
  status: text("status").$type<"ok" | "failed_qa" | "rejected" | "error">().notNull(),
  qaScores: text("qa_scores", { mode: "json" }).$type<Record<string, unknown>>(),
  qaReason: text("qa_reason"),
  outputSize: text("output_size"),
  outputPath: text("output_path"),
  compositePath: text("composite_path"),
  costUsd: real("cost_usd").notNull().default(0),
  ms: integer("ms").notNull().default(0),
  selected: integer("selected", { mode: "boolean" }).notNull().default(false),
  inputs: text("inputs", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  promptVersion: text("prompt_version").notNull(),
  settingsVersion: integer("settings_version").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sceneResults = sqliteTable("scene_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: text("order_id").notNull().references(() => orders.id),
  sceneId: text("scene_id").notNull().references(() => scenes.id),
  status: text("status").$type<"done" | "flagged" | "error">().notNull(),
  path: text("path"),
  flaggedInstances: text("flagged_instances", { mode: "json" }).$type<{ instanceId: string; reason: string }[]>().notNull().default([]),
  costUsd: real("cost_usd").notNull().default(0),
  outsideUnionIdentical: integer("outside_union_identical", { mode: "boolean" }),
  createdAt: text("created_at").notNull(),
});

export const orderScenes = sqliteTable("order_scenes", {
  orderId: text("order_id").notNull().references(() => orders.id),
  sceneId: text("scene_id").notNull().references(() => scenes.id),
});
