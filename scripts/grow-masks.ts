import sharp from "sharp";
import { distanceToZero, invert, readMaskBinary } from "../src/pipeline/maskops";

// Even (distance-based) dilation of the mask, from a backup of the proposed masks.
const radius = Number(process.argv[2] ?? 50);
const src = process.argv[3] ?? "out/mask-backup";
for (const name of ["front", "side", "back"]) {
  const m = await readMaskBinary(await sharp(`${src}/${name}.png`).toBuffer(), 128);
  const d = distanceToZero(invert(m.bin), m.width, m.height);
  const out = Buffer.alloc(m.width * m.height);
  for (let i = 0; i < out.length; i++) out[i] = m.bin[i] || (d[i] as number) <= radius ? 255 : 0;
  await sharp(out, { raw: { width: m.width, height: m.height, channels: 1 } }).toColourspace("b-w").png().toFile(`test-data/masks/${name}.png`);

  const scene = await sharp(`test-data/scenes/${name}.png`).removeAlpha().raw().toBuffer();
  for (let i = 0; i < out.length; i++) if (out[i]) { scene[i * 3] = Math.round((scene[i * 3] as number) * 0.6 + 255 * 0.4); scene[i * 3 + 1] = Math.round((scene[i * 3 + 1] as number) * 0.6); scene[i * 3 + 2] = Math.round((scene[i * 3 + 2] as number) * 0.6); }
  await sharp(scene, { raw: { width: m.width, height: m.height, channels: 3 } }).png().toFile(`out/mask-review/${name}.png`);
  console.log(name, "white px", out.filter((v) => v).length);
}
