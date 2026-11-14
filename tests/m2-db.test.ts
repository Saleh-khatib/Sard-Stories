import { eq } from "drizzle-orm";
import { createConnection } from "node:net";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../src/db/client";
import { childProfiles, orders, sceneRenders, sceneResults } from "../src/db/schema";
import { createOrder, ensureSheets, importScene, orderCost, runSceneForOrder } from "../src/orders/service";
import { createQueue, enqueueOrder, startWorker, waitForOrder } from "../src/queue/render-queue";
import { limiter } from "../src/pipeline/studio";
import { loadSettings, saveSettings, settingsByVersion } from "../src/settings/load";
import { fakeClient, testSettings } from "./fake";
import { ellipseMask, gradientScene } from "./helpers";

const W = 900, H = 600;

async function redisUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection({ host: "127.0.0.1", port: 6379 });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "m2-"));
  await mkdir(join(dir, "masks"), { recursive: true });
  const originalPath = join(dir, "scene.png");
  await writeFile(originalPath, await gradientScene(W, H));
  const maskA = join(dir, "masks", "a.png"), maskB = join(dir, "masks", "b.png");
  await writeFile(maskA, await ellipseMask(W, H, 150, 150, 60, 75));
  await writeFile(maskB, await ellipseMask(W, H, 450, 150, 60, 75));
  const photoPath = join(dir, "photo.jpg");
  await writeFile(photoPath, await sharp({ create: { width: 200, height: 300, channels: 3, background: "#aa8866" } }).jpeg().toBuffer());
  return { dir, originalPath, maskA, maskB, photoPath };
}

async function seed(db: Awaited<ReturnType<typeof openMemoryDb>>, f: Awaited<ReturnType<typeof fixture>>, sceneId = "collage") {
  await importScene(db, { id: sceneId, name: "Collage", originalPath: f.originalPath, width: W, height: H, instances: [
    { id: `${sceneId}-a`, kind: "character", view: "front", ageStage: "child", maskPath: f.maskA },
    { id: `${sceneId}-b`, kind: "character", view: "side", ageStage: "teen", maskPath: f.maskB },
  ] });
  const settings = await saveSettings(testSettings({ candidates: 2, maxAutoRetries: 1 }), db, "test");
  await createOrder(db, { id: "o1", name: "Test order", settingsVersion: settings.version, sceneIds: [sceneId], child: { name: "Omar", gender: "boy", photoPath: f.photoPath } });
  return settings;
}

describe("versioned settings in the database", () => {
  it("seeds version 1, and saving adds a new active version without touching the old one", async () => {
    const db = await openMemoryDb();
    const v1 = await loadSettings(db);
    expect(v1.version).toBe(1);
    const changed = { ...v1, generation: { ...v1.generation, temperature: 0.9 } };
    const v2 = await saveSettings(changed, db, "warmer");
    expect(v2.version).toBe(2);
    expect((await loadSettings(db)).generation.temperature).toBe(0.9);
    expect((await settingsByVersion(1, db))?.generation.temperature).toBe(v1.generation.temperature);
  });
});

describe("orders", () => {
  it("will not generate until the operator has approved the character sheets", async () => {
    const db = await openMemoryDb();
    const f = await fixture();
    const settings = await seed(db, f);
    const { client } = await fakeClient();
    await ensureSheets({ db, client, settings, orderId: "o1", autoApprove: false, root: join(f.dir, "storage") });
    await expect(runSceneForOrder({ db, client, settings, orderId: "o1", sceneId: "collage", root: join(f.dir, "storage") })).rejects.toThrow(/not approved/);
    const [p] = await db.select().from(childProfiles).where(eq(childProfiles.orderId, "o1"));
    expect(Object.keys(p?.sheets ?? {}).sort()).toEqual(["child", "teen"]);
    expect(Object.values(p?.sheets ?? {}).every((s) => s?.approved === false)).toBe(true);
  });

  it("lets a scene be imported again after renders exist, without losing history", async () => {
    const db = await openMemoryDb();
    const f = await fixture();
    const settings = await seed(db, f);
    const { client } = await fakeClient();
    const root = join(f.dir, "storage");
    await ensureSheets({ db, client, settings, orderId: "o1", autoApprove: true, root });
    await runSceneForOrder({ db, client, settings, orderId: "o1", sceneId: "collage", root });
    const before = (await db.select().from(sceneRenders)).length;
    expect(before).toBeGreaterThan(0);
    await importScene(db, { id: "collage", name: "Collage v2", originalPath: f.originalPath, width: W, height: H, instances: [
      { id: "collage-a", kind: "character", view: "front", ageStage: "child", maskPath: f.maskA },
      { id: "collage-b", kind: "character", view: "side", ageStage: "teen", maskPath: f.maskB },
    ] });
    expect((await db.select().from(sceneRenders)).length).toBe(before);
    await importScene(db, { id: "collage", name: "Collage v3", originalPath: f.originalPath, width: W, height: H, instances: [
      { id: "collage-a", kind: "character", view: "front", ageStage: "child", maskPath: f.maskA },
    ] });
    expect((await db.select().from(sceneRenders)).length).toBe(before);
  });

  it("runs end to end through the Redis queue, records every render and totals the cost", async (ctx) => {
    if (!(await redisUp())) return ctx.skip();
    const db = await openMemoryDb();
    const f = await fixture();
    await seed(db, f);
    const { client, calls } = await fakeClient();
    const queueName = `test-render-${Date.now()}`;
    const root = join(f.dir, "storage");
    const { close, queue } = await startWorker({ db, clientFor: () => client, queueName, root });
    try {
      const q = createQueue(queueName);
      await enqueueOrder(q, "o1", { autoApprove: true });
      const order = await waitForOrder(db, "o1", 45_000, 100);
      expect(order.status).toBe("done");

      const renders = await db.select().from(sceneRenders).where(eq(sceneRenders.orderId, "o1"));
      expect(renders).toHaveLength(4);
      expect(renders.filter((r) => r.selected)).toHaveLength(2);
      expect(renders.every((r) => r.settingsVersion === order.settingsVersion && r.costUsd > 0 && r.promptVersion.length > 3)).toBe(true);
      const [result] = await db.select().from(sceneResults).where(eq(sceneResults.orderId, "o1"));
      expect(result?.status).toBe("done");
      expect(result?.outsideUnionIdentical).toBe(true);
      expect(order.actualCost).toBeGreaterThan(renders.reduce((a, r) => a + r.costUsd, 0));
      expect(order.actualCost).toBeCloseTo(await orderCost(db, "o1"), 6);
      expect(calls.filter((c) => c.kind === "card")).toHaveLength(1);
      expect(calls.filter((c) => c.kind === "image").length).toBeGreaterThanOrEqual(6);
      await q.obliterate({ force: true });
      await q.close();
    } finally {
      await queue.obliterate({ force: true });
      await close();
    }
  }, 60_000);

  it("limits concurrent model calls with the shared limiter", async () => {
    const run = limiter(1);
    let active = 0, max = 0;
    await Promise.all([1, 2, 3].map(() => run(async () => { active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 5)); active--; })));
    expect(max).toBe(1);
  });
});

describe("db shape", () => {
  it("keeps order rows queryable", async () => {
    const db = await openMemoryDb();
    expect(await db.select().from(orders)).toEqual([]);
  });
});
