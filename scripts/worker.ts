import "dotenv/config";
import { getDb } from "../src/db/client";
import { STORAGE_ROOT } from "../src/orders/service";
import { makeClient } from "../src/pipeline/genai";
import { startWorker } from "../src/queue/render-queue";
import { loadSettings } from "../src/settings/load";

// Long-running render worker (the "worker" container in Docker Compose). Needs Redis and Vertex credentials.
const db = await getDb();
const settings = await loadSettings(db);
const { close } = await startWorker({ db, clientFor: (s) => makeClient(s), queueName: settings.queue.name, root: STORAGE_ROOT });
console.log(`worker up: queue "${settings.queue.name}", ${settings.queue.sceneConcurrency} scene(s) at a time, settings v${settings.version}`);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => void close().then(() => process.exit(0)));
