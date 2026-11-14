import sharp from "sharp";

export async function gradientScene(w: number, h: number, channels: 3 | 4 = 3): Promise<Buffer> {
  const data = Buffer.alloc(w * h * channels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * channels;
      data[o] = (x * 255) / w;
      data[o + 1] = (y * 255) / h;
      data[o + 2] = (x * y) % 256;
      if (channels === 4) data[o + 3] = 255;
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels } }).png().toBuffer();
}

export async function ellipseMask(w: number, h: number, cx: number, cy: number, rx: number, ry: number): Promise<Buffer> {
  const data = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) data[y * w + x] = 255;
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
}

export async function solid(w: number, h: number, rgb: [number, number, number]): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .png()
    .toBuffer();
}
