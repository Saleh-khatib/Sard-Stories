import sharp from "sharp";
import { SUPPORTED_RATIOS } from "./ratios";
import { binaryBBox, readMaskBinary, type Box } from "./maskops";

export { SUPPORTED_RATIOS };

export interface CropBox extends Box {
  ratio: string;
}

/** Smallest box of a supported ratio that contains the padded mask box and fits in the image. */
export function snapBox(maskBox: Box, imgW: number, imgH: number, paddingPct: number): CropBox {
  const padX = Math.ceil((maskBox.width * paddingPct) / 100);
  const padY = Math.ceil((maskBox.height * paddingPct) / 100);

  const pick = (needW: number, needH: number) => {
    let best: { label: string; w: number; h: number; area: number } | null = null;
    for (const r of SUPPORTED_RATIOS) {
      const k = Math.ceil(Math.max(needW / r.w, needH / r.h));
      const w = r.w * k;
      const h = r.h * k;
      if (w > imgW || h > imgH) continue;
      if (!best || w * h < best.area) best = { label: r.label, w, h, area: w * h };
    }
    return best;
  };

  const best = pick(maskBox.width + 2 * padX, maskBox.height + 2 * padY) ?? pick(maskBox.width, maskBox.height);
  if (!best) throw new Error("Mask does not fit in any supported aspect ratio inside the image");

  const place = (start: number, size: number, maskStart: number, maskSize: number, limit: number) => {
    let s = Math.round(start + maskSize / 2 - size / 2);
    s = Math.max(0, Math.min(limit - size, s));
    if (s > maskStart) s = maskStart;
    if (s + size < maskStart + maskSize) s = maskStart + maskSize - size;
    return Math.max(0, Math.min(limit - size, s));
  };

  return {
    left: place(maskBox.left, best.w, maskBox.left, maskBox.width, imgW),
    top: place(maskBox.top, best.h, maskBox.top, maskBox.height, imgH),
    width: best.w,
    height: best.h,
    ratio: best.label,
  };
}

export async function cropInstance(
  scene: Buffer,
  mask: Buffer,
  opts: { paddingPct: number; maskThreshold: number },
): Promise<CropBox> {
  const meta = await sharp(scene).metadata();
  const { bin, width, height } = await readMaskBinary(mask, opts.maskThreshold);
  if (width !== meta.width || height !== meta.height) {
    throw new Error(`Mask is ${width}x${height} but scene is ${meta.width}x${meta.height}`);
  }
  const bbox = binaryBBox(bin, width, height);
  if (!bbox) throw new Error("Mask is empty (no white pixels)");
  return snapBox(bbox, width, height, opts.paddingPct);
}
