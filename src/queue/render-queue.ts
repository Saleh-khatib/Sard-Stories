import type { GoogleGenAI } from "@google/genai";
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { orderScenes, orders } from "../db/schema";
import { ensureSheets, markSceneError, runSceneForOrder } from "../orders/service";
import { limiter } from "../pipeline/studio";
import { loadSettings, settingsByVersion } from "../settings/load";
import type { M1Settings } from "../settings/schema";

export type RenderJob =
  | { kind: "sheets"; orderId: string; autoApprove?: boolean }
  | { kind: "scene"; orderId: string; sceneId: string };

export const JOB_ATTEMPTS = 2;

export function redisConnection(url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379"): ConnectionOptions {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined, db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined, maxRetriesPerRequest: null };
}

export interface WorkerDeps {
  db: Db;
  clientFor: (settings: M1Settings) => GoogleGenAI;
  queueName: string;
  connection?: ConnectionOptions;
  root?: string;
  outDir?: (orderId: string) => string | null;
}

const jobOpts = { attempts: JOB_ATTEMPTS, backoff: { type: "exponential" as const, delay: 5000 }, removeOnComplete: 200, removeOnFail: 500 };

export function createQueue(name: string, connection: ConnectionOptions = redisConnection()): Queue<RenderJob> {
  return new Queue<RenderJob>(name, { connection });
}

export async function enqueueOrder(queue: Queue<RenderJob>, orderId: string, opts: { autoApprove?: boolean } = {}): Promise<void> {
  await queue.add("sheets", { kind: "sheets", orderId, autoApprove: opts.autoApprove }, jobOpts);
}

/** The worker: a "sheets" job per order, which then queues one "scene" job per scene. Concurrency comes from Settings. */
export async function startWorker(deps: WorkerDeps): Promise<{ worker: Worker<RenderJob>; queue: Queue<RenderJob>; close: () => Promise<void> }> {
  const connection = deps.connection ?? redisConnection();
  const active = await loadSettings(deps.db);
  const schedule = limiter(active.generation.concurrency);
  const queue = createQueue(deps.queueName, connection);

  const settingsFor = async (orderId: string): Promise<M1Settings> => {
    const [order] = await deps.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) throw new Error(`Order ${orderId} not found`);
    return (await settingsByVersion(order.settingsVersion, deps.db)) ?? active;
  };

  const worker = new Worker<RenderJob>(
    deps.queueName,
    async (job) => {
      const data = job.data;
      const settings = await settingsFor(data.orderId);
      const client = deps.clientFor(settings);
      if (data.kind === "sheets") {
        await ensureSheets({ db: deps.db, client, settings, orderId: data.orderId, autoApprove: data.autoApprove, schedule, root: deps.root });
        const links = await deps.db.select().from(orderScenes).where(eq(orderScenes.orderId, data.orderId));
        for (const l of links) await queue.add("scene", { kind: "scene", orderId: data.orderId, sceneId: l.sceneId }, jobOpts);
        return;
      }
      try {
        await runSceneForOrder({ db: deps.db, client, settings, orderId: data.orderId, sceneId: data.sceneId, schedule, root: deps.root, outDir: deps.outDir?.(data.orderId) ?? null });
      } catch (e) {
        if (job.attemptsMade + 1 >= JOB_ATTEMPTS) await markSceneError(deps.db, data.orderId, data.sceneId, e instanceof Error ? e.message : String(e));
        throw e;
      }
    },
    { connection, concurrency: active.queue.sceneConcurrency },
  );

  worker.on("failed", async (job, err) => {
    if (job?.data.kind === "sheets" && job.attemptsMade >= JOB_ATTEMPTS) {
      await deps.db.update(orders).set({ status: "error" }).where(eq(orders.id, job.data.orderId));
      console.error(`sheets job for ${job.data.orderId} failed: ${err.message}`);
    }
  });

  return { worker, queue, close: async () => { await worker.close(); await queue.close(); } };
}

export async function waitForOrder(db: Db, orderId: string, timeoutMs = 20 * 60_000, pollMs = 1500): Promise<typeof orders.$inferSelect> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const [o] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (o && (o.status === "done" || o.status === "flagged" || o.status === "error")) return o;
    if (Date.now() > end) throw new Error(`Timed out waiting for order ${orderId}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
