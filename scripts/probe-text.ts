import "dotenv/config";
import { loadSettings } from "../src/settings/load";
import { generateJson, makeClient } from "../src/pipeline/genai";

const settings = await loadSettings();
const client = makeClient(settings);
const cands = process.argv.slice(2);
for (const model of cands) {
  try {
    const r = await generateJson<{ ok: boolean }>(client, settings, {
      model, parts: [{ text: 'Reply with JSON {"ok": true}' }],
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    });
    console.log("AVAILABLE", model, JSON.stringify(r.value));
  } catch (e) {
    const m = (e as Error).message;
    console.log("no", model, m.includes("404") ? "404" : m.slice(0, 120));
  }
}
