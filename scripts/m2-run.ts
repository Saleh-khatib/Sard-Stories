import "dotenv/config";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { getDb } from "../src/db/client";
import { createOrder, importScene, STORAGE_ROOT } from "../src/orders/service";
import { loadOrderSummary } from "../src/orders/summary";
import { makeClient } from "../src/pipeline/genai";
import { ChildInfoSchema, infoPath, photoPath } from "../src/pipeline/inputs";
import { renderM2Report } from "../src/pipeline/report-m2";
import { startWorker, createQueue, enqueueOrder, waitForOrder } from "../src/queue/render-queue";
import { loadSettings } from "../src/settings/load";
import type { InstanceKind } from "../src/db/schema";

// Runs the M2 acceptance scene unattended through the real queue and writes out/m2/<order>/report.html.
const manifest = JSON.parse(await readFile("test-data/m2/manifest.json", "utf8")) as {
  scene: { id: string; name: string; image: string };
  instances: { id: string; kind: InstanceKind; view: "front" | "side" | "back"; ageStage: "child" | "teen" | "adult"; mask: string; originalWords?: string; newWordsTemplate?: string }[];
};
const db = await getDb();
const settings = await loadSettings(db);
const meta = await sharp(manifest.scene.image).metadata();
await importScene(db, { id: manifest.scene.id, name: manifest.scene.name, originalPath: manifest.scene.image, width: meta.width ?? 0, height: meta.height ?? 0, instances: manifest.instances.map((i) => ({ id: i.id, kind: i.kind, view: i.view, ageStage: i.ageStage, maskPath: i.mask, originalWords: i.originalWords, newWordsTemplate: i.newWordsTemplate })) });
const child = ChildInfoSchema.parse(JSON.parse(await readFile(infoPath("test-data"), "utf8")));
const orderId = `m2-${new Date().toISOString().replace(/[:.]/g, "-")}`;
await createOrder(db, { id: orderId, name: "M2 acceptance", settingsVersion: settings.version, sceneIds: [manifest.scene.id], child: { ...child, photoPath: photoPath("test-data") } });

const outDir = join("out/m2", orderId);
await mkdir(outDir, { recursive: true });
console.log(`order ${orderId}: ${manifest.instances.length} instances, model ${settings.models.sceneEdit}, ${settings.generation.candidates} candidates, up to ${settings.qa.maxAutoRetries} retries`);
const queueName = `${settings.queue.name}-${orderId}`;
const { close, queue } = await startWorker({ db, clientFor: (s) => makeClient(s), queueName, root: STORAGE_ROOT, outDir: () => outDir });
const q = createQueue(queueName);
const started = Date.now();
await enqueueOrder(q, orderId, { autoApprove: true });
const order = await waitForOrder(db, orderId);
await q.obliterate({ force: true }); await q.close(); await queue.obliterate({ force: true }); await close();

const summary = await loadOrderSummary(db, orderId);
const result = summary.results[0];
const files = { original: join(outDir, "original.png"), final: join(outDir, "personalised.png"), sheets: {} as Record<string, string> };
await copyFile(manifest.scene.image, files.original);
if (result?.path) await copyFile(result.path, files.final);
for (const [stage, ref] of Object.entries(summary.child.sheets)) { const p = join(outDir, `sheet-${stage}.png`); await copyFile(ref.path, p); files.sheets[stage] = p; }
await writeFile(join(outDir, "report.html"), renderM2Report(summary, outDir, files));
await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

console.log(`\nstatus: ${order.status} in ${((Date.now() - started) / 1000).toFixed(0)}s · total cost $${summary.totals.costUsd.toFixed(3)} · ${summary.totals.renders} renders recorded`);
console.log(`outside-mask pixels identical: ${result?.outsideUnionIdentical}`);
for (const i of summary.instances) {
  const chosen = i.renders.find((r) => r.id === i.selectedId);
  const reads = i.renders.flatMap((r) => r.qa?.ocr?.reads.map((x) => x.text) ?? []);
  console.log(`  ${i.id.padEnd(12)} ${chosen ? "PASSED " : "FLAGGED"} rounds ${Math.max(...i.renders.map((r) => r.version))} · ${i.renders.length} candidates · $${i.costUsd.toFixed(3)}${i.expected ? ` · expected "${i.expected}", OCR saw ${[...new Set(reads)].map((t) => `"${t}"`).join(", ")}` : ""}`);
}
for (const f of result?.flaggedInstances ?? []) console.log(`  FLAG ${f.instanceId}: ${f.reason}`);
console.log(`report: ${join(outDir, "report.html")}`);
process.exit(0);
