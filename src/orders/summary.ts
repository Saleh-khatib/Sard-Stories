import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { childProfiles, instances, orders, sceneRenders, sceneResults, type SheetRef } from "../db/schema";
import type { QaScores } from "../pipeline/verdict";

export interface OrderSummary {
  order: typeof orders.$inferSelect;
  child: { name: string; gender: string; featureCard: Record<string, unknown> | null; sheets: Record<string, SheetRef> };
  results: (typeof sceneResults.$inferSelect)[];
  instances: {
    id: string;
    sceneId: string;
    kind: string;
    ageStage: string;
    view: string;
    originalWords: string | null;
    expected: string | null;
    renders: (Omit<typeof sceneRenders.$inferSelect, "qaScores"> & { qa: QaScores | null })[];
    selectedId: number | null;
    costUsd: number;
  }[];
  totals: { renders: number; costUsd: number; sheetCostUsd: number; flagged: number };
}

export async function loadOrderSummary(db: Db, orderId: string): Promise<OrderSummary> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) throw new Error(`Order ${orderId} not found`);
  const [profile] = await db.select().from(childProfiles).where(eq(childProfiles.orderId, orderId)).limit(1);
  const renders = await db.select().from(sceneRenders).where(eq(sceneRenders.orderId, orderId)).orderBy(sceneRenders.id);
  const results = await db.select().from(sceneResults).where(and(eq(sceneResults.orderId, orderId)));
  const insts = await db.select().from(instances);
  const mine = insts.filter((i) => renders.some((r) => r.instanceId === i.id));
  const sheets = (profile?.sheets ?? {}) as Record<string, SheetRef>;
  const sheetCost = Object.values(sheets).reduce((a, s) => a + s.costUsd, 0);
  const rows = mine.map((i) => {
    const rs = renders.filter((r) => r.instanceId === i.id).map(({ qaScores, ...r }) => ({ ...r, qa: qaScores as unknown as QaScores | null }));
    const expected = rs.map((r) => (r.inputs as { expectedText?: string | null }).expectedText).find((x) => x) ?? null;
    return { id: i.id, sceneId: i.sceneId, kind: i.kind, ageStage: i.ageStage, view: i.view, originalWords: i.originalWords, expected, renders: rs, selectedId: rs.find((r) => r.selected)?.id ?? null, costUsd: rs.reduce((a, r) => a + r.costUsd, 0) };
  });
  return {
    order,
    child: { name: profile?.name ?? "", gender: profile?.gender ?? "", featureCard: profile?.featureCard ?? null, sheets },
    results,
    instances: rows,
    totals: { renders: renders.length, costUsd: renders.reduce((a, r) => a + r.costUsd, 0) + sheetCost, sheetCostUsd: sheetCost, flagged: results.reduce((a, r) => a + r.flaggedInstances.length, 0) },
  };
}
