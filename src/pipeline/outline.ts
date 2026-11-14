import sharp from "sharp";
import { readRaw, rawToPng } from "./maskops";

/** Draws the edit area's boundary in red on a crop (a PNG the model sees as "image 2"). */
export async function outlineCrop(crop: Buffer, maskCrop: Uint8Array, width: number, height: number, thickness = 3): Promise<Buffer> {
  const raw = await readRaw(await sharp(crop).removeAlpha().png().toBuffer());
  const edge = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!maskCrop[i]) continue;
      const border =
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        !maskCrop[i - 1] || !maskCrop[i + 1] || !maskCrop[i - width] || !maskCrop[i + width];
      if (border) edge[i] = 1;
    }
  }
  const t = Math.max(1, Math.round(thickness));
  const out = Buffer.from(raw.data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!edge[y * width + x]) continue;
      for (let dy = -t; dy <= t; dy++) {
        for (let dx = -t; dx <= t; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const o = (yy * width + xx) * 3;
          out[o] = 255; out[o + 1] = 0; out[o + 2] = 0;
        }
      }
    }
  }
  return rawToPng({ data: out, width, height, channels: 3 });
}
