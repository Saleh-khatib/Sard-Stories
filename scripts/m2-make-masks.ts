import "dotenv/config";
import { mkdir, readFile } from "node:fs/promises";
import sharp from "sharp";
import { generateJson, imagePart, makeClient } from "../src/pipeline/genai";
import { distanceToZero, invert } from "../src/pipeline/maskops";
import { loadSettings } from "../src/settings/load";

// Proposes masks for the synthetic M2 collage. A person must check out/mask-review/m2-all.png before they are used.
const settings = await loadSettings();
const client = makeClient(settings);
const scene = await readFile("test-data/m2/collage.png");
const { width: W = 0, height: H = 0 } = await sharp(scene).metadata();
const k = W / 2000; // panel bounds below are measured on a 2000 px wide view
const panels = { left: [10, 657], middle: [676, 1323], right: [1343, 1990] } as const;

const heads = [
  { id: "child-front", panel: "left", desc: "the head of the young boy in the LEFT panel: all hair, both ears, the face and the neck down to where the red jacket collar begins" },
  { id: "teen-side", panel: "middle", desc: "the head of the teenager in the MIDDLE panel seen in profile: all hair, the ear, the face and the neck down to where the green shirt collar begins" },
  { id: "adult-back", panel: "right", desc: "the back of the head of the person in the RIGHT panel seen from behind: all hair, both ears and the neck down to where the green shirt collar begins" },
] as const;
const SCHEMA = { type: "object", properties: { points: { type: "array", items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] } } }, required: ["points"] };

await mkdir("test-data/m2/masks", { recursive: true });
await mkdir("out/mask-review", { recursive: true });
const all = Buffer.alloc(W * H * 3);
(await sharp(scene).removeAlpha().raw().toBuffer()).copy(all);

async function save(id: string, bin: Uint8Array, rgb: [number, number, number]) {
  const png = Buffer.alloc(W * H);
  for (let i = 0; i < png.length; i++) if (bin[i]) { png[i] = 255; for (let c = 0; c < 3; c++) all[i * 3 + c] = Math.round((all[i * 3 + c] as number) * 0.45 + rgb[c]! * 0.55); }
  await sharp(png, { raw: { width: W, height: H, channels: 1 } }).toColourspace("b-w").png().toFile(`test-data/m2/masks/${id}.png`);
  console.log(id, "white px", png.filter((v) => v).length);
}

// Shirt print: name above the number, wide enough for a five-letter name.
const jersey = new Uint8Array(W * H);
const [jx0, jy0, jx1, jy1] = [1530, 590, 1790, 1030].map((v) => Math.round(v * k)) as [number, number, number, number];
for (let y = jy0; y < jy1; y++) for (let x = jx0; x < jx1; x++) jersey[y * W + x] = 1;

const colors: [number, number, number][] = [[255, 0, 0], [0, 90, 255], [255, 160, 0]];
for (const [n, h] of heads.entries()) {
  const r = await generateJson<{ points: { x: number; y: number }[] }>(client, settings, {
    model: settings.models.visionJudge,
    parts: [imagePart(scene), { text: `Trace the outline of ${h.desc} as a closed polygon of 40 to 60 points, tightly following the silhouette including every hair tuft. Coordinates are normalised 0-1000 (x from the left edge of the whole image, y from the top).` }],
    schema: SCHEMA,
  });
  const pts = r.value.points.map((p) => `${((p.x / 1000) * W).toFixed(1)},${((p.y / 1000) * H).toFixed(1)}`).join(" ");
  const raw = await sharp(Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#000"/><polygon points="${pts}" fill="#fff"/></svg>`)).greyscale().raw().toBuffer();
  const bin = new Uint8Array(W * H);
  let minY = H, maxY = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((raw[y * W + x] as number) > 127) { bin[y * W + x] = 1; minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const grow = Math.round((maxY - minY) * 0.14);
  const d = distanceToZero(invert(bin), W, H);
  const [x0, x1] = panels[h.panel].map((v) => Math.round(v * k)) as [number, number];
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = x0; x <= x1 && x < W; x++) { const i = y * W + x; if (!jersey[i] && (bin[i] || (d[i] as number) <= grow)) out[i] = 1; }
  console.log(h.id, "grow", grow, "px");
  await save(h.id, out, colors[n] as [number, number, number]);
}

await save("jersey", jersey, [0, 200, 0]);
await sharp(all, { raw: { width: W, height: H, channels: 3 } }).resize({ width: 1600 }).png().toFile("out/mask-review/m2-all.png");
