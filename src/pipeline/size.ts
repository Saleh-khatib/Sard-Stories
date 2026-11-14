import type { OutputSize } from "../settings/schema";
import type { GenerationSettings } from "../settings/schema";

export const OUTPUT_LONG_SIDE: Record<OutputSize, number> = { "1K": 1024, "2K": 2048, "4K": 4096 };
const ORDER: OutputSize[] = ["1K", "2K", "4K"];

export function chooseOutputSize(cropW: number, cropH: number, rule: GenerationSettings): OutputSize {
  if (rule.forceSize !== "off") return rule.forceSize;
  const longest = Math.max(cropW, cropH);
  if (longest <= rule.sizeRule.maxLongSideFor1K) return "1K";
  if (longest <= rule.sizeRule.maxLongSideFor2K) return "2K";
  return "4K";
}

export function nextSize(size: OutputSize): OutputSize | null {
  const i = ORDER.indexOf(size);
  return ORDER[i + 1] ?? null;
}
