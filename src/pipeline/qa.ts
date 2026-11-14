import sharp from "sharp";
import ssimModule from "ssim.js";
import type { MaskingSettings } from "../settings/schema";
import { binaryBBox, cropBinary, distanceToZero, invert, readMaskBinary, readRaw } from "./maskops";

const ssim = (ssimModule as unknown as { default?: typeof ssimModule }).default ?? ssimModule;

export async function outsideMaskDiff(
  original: Buffer,
  result: Buffer,
  mask: Buffer,
  threshold: number,
): Promise<{ identical: boolean; differingBytes: number; sizeMatches: boolean }> {
  const [a, b, m] = await Promise.all([readRaw(original), readRaw(result), readMaskBinary(mask, threshold)]);
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) {
    return { identical: false, differingBytes: -1, sizeMatches: false };
  }
  let diff = 0;
  for (let i = 0; i < m.bin.length; i++) {
    if (m.bin[i]) continue;
    for (let c = 0; c < a.channels; c++) {
      if (a.data[i * a.channels + c] !== b.data[i * a.channels + c]) diff++;
    }
  }
  return { identical: diff === 0, differingBytes: diff, sizeMatches: true };
}

export async function outsideMaskIdentical(
  original: Buffer,
  result: Buffer,
  mask: Buffer,
  threshold: number,
): Promise<boolean> {
  return (await outsideMaskDiff(original, result, mask, threshold)).identical;
}

async function grayFloat(png: Buffer, maxSide: number): Promise<{ g: Float32Array; w: number; h: number; scale: number }> {
  const meta = await sharp(png).metadata();
  const longest = Math.max(meta.width ?? 1, meta.height ?? 1);
  const scale = longest > maxSide ? maxSide / longest : 1;
  let pipe = sharp(png).flatten({ background: "#ffffff" }).greyscale();
  if (scale < 1) pipe = pipe.resize(Math.round((meta.width ?? 1) * scale), Math.round((meta.height ?? 1) * scale), { kernel: "lanczos3" });
  const { data, info } = await pipe.raw().toBuffer({ resolveWithObject: true });
  const g = new Float32Array(info.width * info.height);
  for (let i = 0; i < g.length; i++) g[i] = data[i] as number;
  return { g, w: info.width, h: info.height, scale };
}

function sobel(g: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -(g[i - w - 1] as number) + (g[i - w + 1] as number) - 2 * (g[i - 1] as number) + 2 * (g[i + 1] as number) -
        (g[i + w - 1] as number) + (g[i + w + 1] as number);
      const gy =
        -(g[i - w - 1] as number) - 2 * (g[i - w] as number) - (g[i - w + 1] as number) + (g[i + w - 1] as number) +
        2 * (g[i + w] as number) + (g[i + w + 1] as number);
      out[i] = Math.min(255, Math.hypot(gx, gy) / 4);
    }
  }
  return out;
}

async function scaledMask(maskCrop: Uint8Array, cw: number, ch: number, w: number, h: number): Promise<Uint8Array> {
  if (w === cw && h === ch) return maskCrop;
  const buf = Buffer.alloc(cw * ch);
  for (let i = 0; i < buf.length; i++) buf[i] = maskCrop[i] ? 255 : 0;
  const { data } = await sharp(buf, { raw: { width: cw, height: ch, channels: 1 } })
    .resize(w, h, { kernel: "nearest" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = (data[i] as number) > 127 ? 1 : 0;
  return out;
}

/** SSIM between the Sobel edge maps of the original and edited crop, averaged inside the mask only. */
export async function edgeSimilarity(
  originalCrop: Buffer,
  resultCrop: Buffer,
  maskCrop: Uint8Array,
  cropW: number,
  cropH: number,
  masking: Pick<MaskingSettings, "qaMaxSidePx">,
): Promise<number> {
  const [a, b] = await Promise.all([grayFloat(originalCrop, masking.qaMaxSidePx), grayFloat(resultCrop, masking.qaMaxSidePx)]);
  const m = await scaledMask(maskCrop, cropW, cropH, a.w, a.h);
  const bb = binaryBBox(m, a.w, a.h);
  if (!bb) return 0;
  const ea = sobel(a.g, a.w, a.h);
  const eb = sobel(b.g, b.w, b.h);
  const w = bb.width, h = bb.height;
  const toImg = (e: Float32Array) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = e[(bb.top + y) * a.w + bb.left + x] as number;
        const o = (y * w + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = v;
        d[o + 3] = 255;
      }
    }
    return { data: d, width: w, height: h } as unknown as ImageData;
  };
  const res = ssim(toImg(ea), toImg(eb), { maxSize: Math.max(w, h), windowSize: 11 });
  const map = res.ssim_map;
  const sub = cropBinary(m, a.w, bb);
  let sum = 0, cnt = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const mx = Math.min(w - 1, x + 5), my = Math.min(h - 1, y + 5);
      if (!sub[my * w + mx]) continue;
      sum += map.data[y * map.width + x] as number;
      cnt++;
    }
  }
  return cnt ? sum / cnt : 0;
}

/** Colour distance (RGB, 0-255) between the band just inside the mask edge and the band just outside it. */
export async function seamDelta(
  png: Buffer,
  maskCrop: Uint8Array,
  cropW: number,
  cropH: number,
  masking: Pick<MaskingSettings, "seamBandPx">,
): Promise<number> {
  const raw = await readRaw(png);
  const dIn = distanceToZero(maskCrop, cropW, cropH);
  const dOut = distanceToZero(invert(maskCrop), cropW, cropH);
  const band = masking.seamBandPx;
  let ir = 0, ig = 0, ib = 0, ic = 0, or = 0, og = 0, ob = 0, oc = 0;
  for (let i = 0; i < cropW * cropH; i++) {
    const p = i * raw.channels;
    if (maskCrop[i] && (dIn[i] as number) <= band) {
      ir += raw.data[p] as number; ig += raw.data[p + 1] as number; ib += raw.data[p + 2] as number; ic++;
    } else if (!maskCrop[i] && (dOut[i] as number) <= band) {
      or += raw.data[p] as number; og += raw.data[p + 1] as number; ob += raw.data[p + 2] as number; oc++;
    }
  }
  if (!ic || !oc) return 0;
  return Math.hypot(ir / ic - or / oc, ig / ic - og / oc, ib / ic - ob / oc);
}

function laplacianVariance(g: Float32Array, w: number, h: number, select: (i: number) => boolean): number {
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!select(i)) continue;
      const l = 4 * (g[i] as number) - (g[i - 1] as number) - (g[i + 1] as number) - (g[i - w] as number) - (g[i + w] as number);
      sum += l;
      sum2 += l * l;
      n++;
    }
  }
  if (n < 2) return 0;
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

/** Laplacian variance inside the mask divided by the same measure on the surrounding ring. */
export async function sharpnessRatio(
  png: Buffer,
  maskCrop: Uint8Array,
  cropW: number,
  cropH: number,
  masking: Pick<MaskingSettings, "sharpnessRingPx">,
): Promise<number> {
  const { data, info } = await sharp(png).flatten({ background: "#ffffff" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const g = new Float32Array(info.width * info.height);
  for (let i = 0; i < g.length; i++) g[i] = data[i] as number;
  const dOut = distanceToZero(invert(maskCrop), cropW, cropH);
  const inside = laplacianVariance(g, cropW, cropH, (i) => !!maskCrop[i]);
  const ring = laplacianVariance(g, cropW, cropH, (i) => !maskCrop[i] && (dOut[i] as number) <= masking.sharpnessRingPx);
  return ring > 0 ? inside / ring : 0;
}
