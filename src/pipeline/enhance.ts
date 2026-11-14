import sharp from "sharp";
import { SUPPORTED_RATIOS } from "./crop";

export function nearestRatio(width: number, height: number): { label: string; errorPct: number } {
  const target = width / height;
  let best: { label: string; errorPct: number } = { label: "1:1", errorPct: Infinity };
  for (const r of SUPPORTED_RATIOS) {
    const err = Math.abs(r.w / r.h / target - 1) * 100;
    if (err < best.errorPct) best = { label: r.label, errorPct: err };
  }
  return best;
}

/** Resamples a mask to new pixel dimensions (geometry only), keeping it strictly black and white. */
export async function resampleMask(mask: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(await sharp(mask).flatten({ background: "#000000" }).greyscale().resize(width, height, { fit: "fill", kernel: "lanczos3" }).threshold(128).png().toBuffer())
    .toColourspace("b-w")
    .png({ compressionLevel: 9 })
    .toBuffer();
}
