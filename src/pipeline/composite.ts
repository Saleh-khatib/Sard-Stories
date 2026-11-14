import sharp from "sharp";
import type { M1Settings } from "../settings/schema";
import {
  cropBinary,
  distanceToZero,
  invert,
  meanColor,
  rawToPng,
  readMaskBinary,
  readRaw,
} from "./maskops";
import type { CropBox } from "./crop";

export type CompositeResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      image: Buffer;
      scaled: boolean;
      scaleFactor: number;
      aspectErrorPct: number;
      seamShift: [number, number, number] | null;
    };

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/**
 * Pastes the model output into the original through a feathered mask.
 * The feather only reaches inwards, so pixels outside the mask are never touched.
 * Returns a new PNG; inputs are never modified.
 */
export async function composite(
  original: Buffer,
  modelOutput: Buffer,
  mask: Buffer,
  box: CropBox,
  settings: Pick<M1Settings, "masking" | "generation">,
): Promise<CompositeResult> {
  const { masking, generation } = settings;
  const orig = await readRaw(original);
  const outMeta = await sharp(modelOutput).metadata();
  const ow = outMeta.width ?? 0;
  const oh = outMeta.height ?? 0;

  if (ow < box.width || oh < box.height) {
    return { ok: false, reason: `model output ${ow}x${oh} is smaller than the crop ${box.width}x${box.height}` };
  }
  const aspectErrorPct = Math.abs(ow / oh / (box.width / box.height) - 1) * 100;
  if (aspectErrorPct > generation.maxAspectErrorPct) {
    return { ok: false, reason: `model output aspect ratio is off by ${aspectErrorPct.toFixed(1)}%` };
  }

  const m = await readMaskBinary(mask, masking.maskThreshold);
  if (m.width !== orig.width || m.height !== orig.height) {
    return { ok: false, reason: `mask ${m.width}x${m.height} does not match original ${orig.width}x${orig.height}` };
  }
  if (box.left + box.width > orig.width || box.top + box.height > orig.height) {
    return { ok: false, reason: "crop box is outside the original" };
  }

  const { width: w, height: h } = box;
  const scaled = ow !== w || oh !== h;
  const out = await sharp(modelOutput)
    .removeAlpha()
    .resize(w, h, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer();

  const cm = cropBinary(m.bin, orig.width, box);
  const dIn = distanceToZero(cm, w, h);
  const dOut = distanceToZero(invert(cm), w, h);
  const n = w * h;

  const origCrop = Buffer.alloc(n * orig.channels);
  for (let y = 0; y < h; y++) {
    const s = ((box.top + y) * orig.width + box.left) * orig.channels;
    orig.data.copy(origCrop, y * w * orig.channels, s, s + w * orig.channels);
  }

  let seamShift: [number, number, number] | null = null;
  const shifted = Buffer.from(out);
  if (masking.seamColorMatch) {
    const band = masking.seamBandPx;
    const ring = meanColor(origCrop, orig.channels, (i) => !cm[i] && (dOut[i] as number) <= band, n);
    const inner = meanColor(out, 3, (i) => !!cm[i] && (dIn[i] as number) <= band, n);
    if (ring && inner) {
      const lim = masking.seamMaxShift;
      const off = ring.map((v, c) => Math.max(-lim, Math.min(lim, v - (inner[c] as number)))) as [number, number, number];
      seamShift = off;
      for (let i = 0; i < n; i++) {
        if (!cm[i]) continue;
        const f = Math.max(0, 1 - (dIn[i] as number) / (band * 3));
        if (f === 0) continue;
        for (let c = 0; c < 3; c++) shifted[i * 3 + c] = clamp8((out[i * 3 + c] as number) + (off[c] as number) * f);
      }
    }
  }

  const result = Buffer.from(orig.data);
  const feather = masking.featherPx;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!cm[i]) continue;
      const a = feather > 0 ? smoothstep(Math.min(1, (dIn[i] as number) / feather)) : 1;
      if (a <= 0) continue;
      const dst = ((box.top + y) * orig.width + box.left + x) * orig.channels;
      for (let c = 0; c < 3; c++) {
        result[dst + c] = clamp8((shifted[i * 3 + c] as number) * a + (orig.data[dst + c] as number) * (1 - a));
      }
    }
  }

  return {
    ok: true,
    image: await rawToPng({ data: result, width: orig.width, height: orig.height, channels: orig.channels }),
    scaled,
    scaleFactor: w / ow,
    aspectErrorPct,
    seamShift,
  };
}
