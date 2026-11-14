import type { QaSettings } from "../settings/schema";
import type { JudgeResult } from "./judge";

export interface QaScores {
  outsideIdentical: boolean;
  outsideDiffBytes: number;
  edgeSsim: number;
  seamDelta: number;
  sharpnessRatio: number;
  vision: JudgeResult | null;
  visionError: string | null;
  ocr: { expected: string; reads: { model: string; text: string; error: string | null }[]; exact: boolean } | null;
}

export interface Verdict {
  pass: boolean;
  reasons: string[];
  /** Used only to rank candidates that already passed. */
  score: number;
}

/**
 * Characters pass on structure + vision. Art text passes on structure + an exact OCR read-back, and a vision
 * score can never replace that read-back (rule 7), so the judge is not consulted for it at all.
 */
export function verdictFor(kind: "character" | "art_text", qa: QaScores, t: QaSettings): Verdict {
  const reasons: string[] = [];
  if (!qa.outsideIdentical) reasons.push("pixels changed outside the mask");
  if (qa.edgeSsim < t.edgeSsimMin) reasons.push(`structure changed (edge SSIM ${qa.edgeSsim.toFixed(2)} < ${t.edgeSsimMin})`);
  if (qa.seamDelta > t.seamDeltaMax) reasons.push(`visible seam (${qa.seamDelta.toFixed(1)} > ${t.seamDeltaMax})`);
  if (qa.sharpnessRatio < t.sharpnessRatioMin) reasons.push(`soft result (sharpness ${qa.sharpnessRatio.toFixed(2)} < ${t.sharpnessRatioMin})`);

  if (kind === "art_text") {
    if (!qa.ocr) reasons.push("art text was not read back");
    else if (!qa.ocr.exact) {
      const read = qa.ocr.reads.map((r) => (r.error ? "error" : `"${r.text}"`)).join(" / ");
      reasons.push(`text does not read "${qa.ocr.expected}" (read ${read})`);
    }
    return { pass: reasons.length === 0, reasons, score: qa.edgeSsim };
  }

  if (!qa.vision) reasons.push(`vision judge unavailable${qa.visionError ? `: ${qa.visionError}` : ""}`);
  else {
    if (qa.vision.overall < t.visionScoreMin) reasons.push(`vision score ${qa.vision.overall} < ${t.visionScoreMin}`);
    if (qa.vision.extraFaces) reasons.push("extra faces");
    if (!qa.vision.pass) reasons.push(`judge: ${qa.vision.reason}`);
  }
  return { pass: reasons.length === 0, reasons, score: (qa.vision?.overall ?? 0) + qa.edgeSsim * 0.1 };
}
