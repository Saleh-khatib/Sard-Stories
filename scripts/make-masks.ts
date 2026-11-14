import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { loadSettings } from "../src/settings/load";
import { generateJson, imagePart, makeClient } from "../src/pipeline/genai";

// Proposes head+neck masks from a Gemini polygon outline. A person must review the overlays in out/mask-review/.
const settings = await loadSettings();
const client = makeClient(settings);
const model = process.argv[2] ?? settings.models.visionJudge;
const growPx = Number(process.argv[3] ?? 8);
const names = (process.argv[4]?.split(",") ?? ["front", "side", "back"]);
await mkdir("out/mask-review", { recursive: true });

const PROMPT =
  "Trace the outline of the child's head as a closed polygon: include ALL hair (including the top and any tufts), both ears if visible, the face if visible, and the neck down to where the red jacket collar begins. Exclude the jacket and everything below the neck. Use 40 to 60 points going around the outline clockwise, tightly following the silhouette. Coordinates are normalised 0-1000 (x from the left edge, y from the top edge).";
const SCHEMA = {
  type: "object",
  properties: { points: { type: "array", items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] } } },
  required: ["points"],
};

for (const name of names) {
  const scene = await readFile(`test-data/scenes/${name}.png`);
  const { width: W = 0, height: H = 0 } = await sharp(scene).metadata();
  const r = await generateJson<{ points: { x: number; y: number }[] }>(client, settings, {
    model, parts: [imagePart(scene), { text: PROMPT }], schema: SCHEMA,
  });
  const pts = r.value.points.map((p) => `${((p.x / 1000) * W).toFixed(1)},${((p.y / 1000) * H).toFixed(1)}`).join(" ");
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#000"/><polygon points="${pts}" fill="#fff" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;
  let mask = sharp(Buffer.from(svg)).greyscale().threshold(128);
  if (growPx > 0) mask = sharp(await mask.blur(growPx).threshold(30).png().toBuffer());
  const maskPng = await sharp(await mask.png().toBuffer()).greyscale().png().toBuffer();
  await writeFile(`test-data/masks/${name}.png`, maskPng);

  const m = await sharp(maskPng).extractChannel(0).raw().toBuffer();
  const o = await sharp(scene).removeAlpha().raw().toBuffer();
  for (let i = 0; i < W * H; i++) if (m[i]) { o[i * 3] = Math.round((o[i * 3] as number) * 0.5 + 255 * 0.5); o[i * 3 + 1] = Math.round((o[i * 3 + 1] as number) * 0.5); o[i * 3 + 2] = Math.round((o[i * 3 + 2] as number) * 0.5); }
  await sharp(o, { raw: { width: W, height: H, channels: 3 } }).png().toFile(`out/mask-review/${name}.png`);
  console.log(name, r.value.points.length, "points,", m.filter((v) => v).length, "mask px of", W * H);
}
