import { eq } from "drizzle-orm";
import type { Recorder } from "../pipeline/render";
import type { Db } from "./client";
import { sceneRenders } from "./schema";

/** Rule 5: every model call is stored with its inputs, prompt and settings version, scores, size, cost and status. */
export function dbRecorder(db: Db, orderId: string): Recorder {
  return {
    async record(r) {
      const [row] = await db
        .insert(sceneRenders)
        .values({
          orderId,
          instanceId: r.instanceId,
          version: r.version,
          candidate: r.candidate,
          status: r.status,
          qaScores: r.qaScores as unknown as Record<string, unknown> | null,
          qaReason: r.qaReason,
          outputSize: r.outputSize,
          outputPath: r.outputPath,
          compositePath: r.compositePath,
          costUsd: r.costUsd,
          ms: r.ms,
          selected: r.selected,
          inputs: r.inputs,
          promptVersion: r.promptVersion,
          settingsVersion: r.settingsVersion,
          createdAt: new Date().toISOString(),
        })
        .returning({ id: sceneRenders.id });
      return (row as { id: number }).id;
    },
    async select(renderId) {
      await db.update(sceneRenders).set({ selected: true }).where(eq(sceneRenders.id, renderId));
    },
  };
}
