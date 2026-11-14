import sharp from "sharp";

export interface Raw {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export async function readRaw(input: Buffer): Promise<Raw> {
  const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** 1 where the mask is white (edit area), 0 elsewhere. Transparent pixels count as black. */
export async function readMaskBinary(mask: Buffer, threshold: number): Promise<{ bin: Uint8Array; width: number; height: number }> {
  const { data, info } = await sharp(mask)
    .flatten({ background: "#000000" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bin = new Uint8Array(info.width * info.height);
  for (let i = 0; i < bin.length; i++) bin[i] = (data[i] ?? 0) >= threshold ? 1 : 0;
  return { bin, width: info.width, height: info.height };
}

export function binaryBBox(bin: Uint8Array, width: number, height: number): Box | null {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bin[y * width + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function cropBinary(bin: Uint8Array, width: number, box: Box): Uint8Array {
  const out = new Uint8Array(box.width * box.height);
  for (let y = 0; y < box.height; y++) {
    const src = (box.top + y) * width + box.left;
    out.set(bin.subarray(src, src + box.width), y * box.width);
  }
  return out;
}

/** Distance from each 1-pixel to the nearest 0-pixel (0 for 0-pixels). Pixels outside the array do not count as 0. */
export function distanceToZero(bin: Uint8Array, width: number, height: number): Float32Array {
  const INF = 1e9;
  const SQ2 = Math.SQRT2;
  const d = new Float32Array(width * height);
  for (let i = 0; i < d.length; i++) d[i] = bin[i] ? INF : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let v = d[i] as number;
      if (x > 0) v = Math.min(v, (d[i - 1] as number) + 1);
      if (y > 0) {
        v = Math.min(v, (d[i - width] as number) + 1);
        if (x > 0) v = Math.min(v, (d[i - width - 1] as number) + SQ2);
        if (x < width - 1) v = Math.min(v, (d[i - width + 1] as number) + SQ2);
      }
      d[i] = v;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let v = d[i] as number;
      if (x < width - 1) v = Math.min(v, (d[i + 1] as number) + 1);
      if (y < height - 1) {
        v = Math.min(v, (d[i + width] as number) + 1);
        if (x < width - 1) v = Math.min(v, (d[i + width + 1] as number) + SQ2);
        if (x > 0) v = Math.min(v, (d[i + width - 1] as number) + SQ2);
      }
      d[i] = v;
    }
  }
  return d;
}

export function invert(bin: Uint8Array): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin[i] ? 0 : 1;
  return out;
}

export function meanColor(
  data: Uint8Array | Buffer,
  channels: number,
  select: (i: number) => boolean,
  count: number,
): [number, number, number] | null {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < count; i++) {
    if (!select(i)) continue;
    r += data[i * channels] as number;
    g += data[i * channels + 1] as number;
    b += data[i * channels + 2] as number;
    n++;
  }
  return n ? [r / n, g / n, b / n] : null;
}

export async function extractPng(input: Buffer, box: Box): Promise<Buffer> {
  return sharp(input)
    .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function rawToPng(raw: Raw): Promise<Buffer> {
  return sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: raw.channels as 1 | 2 | 3 | 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
