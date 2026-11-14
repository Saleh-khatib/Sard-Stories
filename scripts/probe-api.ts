import "dotenv/config";
import sharp from "sharp";
import { loadSettings } from "../src/settings/load";
import { generateImage, generateJson, imagePart, makeClient } from "../src/pipeline/genai";

const settings = await loadSettings();
const client = makeClient(settings);
const base = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#f4efe6" } })
  .composite([{ input: Buffer.from('<svg width="512" height="512"><circle cx="256" cy="256" r="120" fill="#d33"/></svg>') }])
  .png().toBuffer();

for (const model of settings.models.compare) {
  try {
    const img = await generateImage(client, { ...settings, generation: { ...settings.generation, seed: 7 } }, {
      model, size: "1K", aspectRatio: "1:1", seed: 7,
      parts: [imagePart(base), { text: "Change the red circle to blue. Keep everything else identical." }],
    });
    console.log(model, "image OK", img.width + "x" + img.height, "mime", img.modelMime, "usage", JSON.stringify(img.usage), "cost $" + img.costUsd.toFixed(4), img.ms + "ms");
  } catch (e) {
    console.log(model, "image FAIL", (e as Error).message.slice(0, 300));
  }
}
for (const model of [settings.models.visionJudge]) {
  try {
    const r = await generateJson<{ color: string }>(client, settings, {
      model,
      parts: [imagePart(base), { text: "What colour is the circle? Answer as JSON." }],
      schema: { type: "object", properties: { color: { type: "string" } }, required: ["color"] },
    });
    console.log(model, "json OK", JSON.stringify(r.value), "usage", JSON.stringify(r.usage));
  } catch (e) {
    console.log(model, "json FAIL", (e as Error).message.slice(0, 300));
  }
}
