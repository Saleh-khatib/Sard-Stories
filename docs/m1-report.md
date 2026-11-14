# M1 proof-of-concept report (D1)

Run `full-1`, 14 Nov 2026. Everything below is measured; nothing is estimated unless marked.
Evidence: `out/m1/full-1/` (report.html, summary.json, per-candidate report.json), earlier runs `out/m1/smoke-1..6/`.
Likeness and style are for Sard to judge from `out/m1/full-1/report.html`; the AI-judge numbers are a screening aid only.

## 1. Setup tested

- 3 scenes from ChatGPT (front, side, back), 1254 x 1254 px, one hero in one style. These are stand-ins for Sard's art, which has not been tested yet.
- Masks proposed by Gemini (polygon outline), then grown 45 px on every side and checked by eye.
- 1 test photo (a photo of a screen, boy). Crop sizes: front 500 px, side 550 px, back 491 px (all 1:1).
- 3 candidates per scene per model: 18 edits. Total run cost $2.11 including the character sheet ($0.14) and the judge calls.
- Lanczos3 downscale only. No JPEG written anywhere (tested).

## 2. Models: availability and cost

Checked on project `sard-stories`, location `global`, with `scripts/check-vertex.ts` and `scripts/probe-*.ts`.

| Model | Result | 1K / 2K / 4K output | Cost per edit (measured) |
| --- | --- | --- | --- |
| gemini-3-pro-image | available | 1024 / 2048 / 4096 | $0.145 |
| gemini-3.1-flash-image | available | 1024 / 2048 / 4096 | $0.073 |
| gemini-2.5-flash-image | available, but ignores size | 1024 / 1024 / 429 | not tested further |
| gemini-3-pro-image-preview | 404 | | |
| gemini-3.1-flash-image-preview | 404 | | |

Text/vision models (judge, feature card): `gemini-2.5-flash` is 404. Available: `gemini-3-flash-preview` (now the default), `gemini-3.1-flash-lite`, `gemini-3.1-pro-preview`.

Cost per instance (3 candidates plus 3 judge calls): pro $0.44, flash $0.22. Prices in `settings.m1.json` are my assumptions applied to the real token counts from `usageMetadata`; please confirm them against Google's price page. The pro figure is close to the published per-image price, which suggests they are right.

Time per candidate (generation only): pro 48 s average, 166 s worst; flash 38 s average, 99 s worst. Whole instance with QA at 2 parallel calls: about 110 s (pro) and 100 s (flash).

## 3. Results per model

All numbers are over the 9 candidates per model (3 scenes x 3).

| | gemini-3-pro-image | gemini-3.1-flash-image |
| --- | --- | --- |
| Passed under the proposed thresholds | 9 / 9 | 9 / 9 |
| Outside-mask pixels identical | 9 / 9 | 9 / 9 |
| Edge SSIM (min / median) | 0.45 / 0.47 | 0.45 / 0.47 |
| Seam delta (max) | 7.0 | 6.9 |
| Sharpness ratio (min) | 2.94 | 3.15 |
| Judge likeness (mean / min) | 9.7 / 9 | 9.6 / 9 |
| Judge style match (mean) | 9.9 | 9.7 |
| Judge overall (mean / min) | 9.78 / 9.0 | 9.61 / 9.0 |
| Size escalations needed | 0 | 0 |

By view, both models passed front, side and back. The back view (expected to be the hardest) scored 10 on most candidates. I compared the two models side by side (`out/m1/full-1/compare-models.png`): they look equivalent. With only 3 candidates per scene the 0.17 gap in judge score is within noise.

No candidate fails, so the per-candidate "fail reasons" come from the earlier smoke runs on the front scene (section 5).

## 4. Proposed defaults

| Setting | Proposed | Basis |
| --- | --- | --- |
| Scene edit model | gemini-3.1-flash-image | Same measured quality at half the cost |
| Fallback model | gemini-3-pro-image | Highest judge mean, used if flash errors twice |
| Character sheet model | gemini-3-pro-image | One call per order, so cost is small and the sheet drives every page |
| Judge / feature card model | gemini-3-flash-preview | Only available flash-class text model; handles image + JSON schema |
| Candidates per instance | 2 | All 18 passed; 3 candidates gave no extra value here. Raise if real art fails more often |
| Concurrency | 2 | 4 parallel calls hit a 429 on the trial project once |
| Crop padding / feather / seam colour match | 15% / 8 px / on | Unchanged from the plan; worked on all 18 |
| Mask growth | 45 px beyond the hair edge | Smaller masks left strands of the old hair |

QA thresholds, set from the measured gap between 18 good results and 4 known-bad results:

| Check | Good results | Known-bad results | Threshold |
| --- | --- | --- | --- |
| Edge SSIM min | 0.45 to 0.94 | 0.30 to 0.34 | 0.40 |
| Seam delta max | 5.5 to 7.0 | 25.6 to 60.9 | 16 |
| Sharpness ratio min | 2.94 to 6.91 | 1.11 to 1.25 | 2.0 |
| Vision overall min | 9.0 to 10 | 4 to 7 (one bad case scored 9) | 8 |
| Outside-mask identical | always | not applicable | must be exactly true |

With these thresholds all 18 good candidates pass and all 4 known-bad ones fail. The 4 bad results are a small sample: they are the front-scene smoke runs with leftover brown hair, and one with a red guide outline drawn into the art. Treat the thresholds as a starting point to re-fit on more data in M2.

## 5. Problems found

1. **Masks must be generous.** My first masks hugged the hair. The model's output was fine, but tufts of the original brown hair stayed outside the mask and showed next to the new head. Fixed by growing the mask 45 px evenly. In production, mask quality decides the result as much as the model does.
2. **The model drew the red guide outline once.** The image showing the edit area in red was reproduced in the output. Fixed with an explicit prompt line; not seen again in 18 runs.
3. **The model keeps the old hair if allowed.** Telling it to remove all original hair and paint background in its place fixed this.
4. **The AI judge is lenient on small flaws.** A result with stray original hair scored 9 and passed the judge. The structural checks (edge SSIM, seam, sharpness) caught it. Keep both.
5. **The seam metric was misleading at first.** With tight masks the original art itself scored 66 at the mask boundary, so I briefly judged against that baseline. That hid the real failures, so the final rule is an absolute seam value.
6. **Rate limits (429).** One front edit failed after retries at 4 parallel calls. At 2 parallel calls with longer back-off, 18 of 18 succeeded. The trial quota needs confirming before production.
7. **Preview model IDs and gemini-2.5-flash are 404** in this project; the 2.5 image model ignores 2K and 4K. Model IDs must stay in Settings.
8. **Output size never mattered in this test.** Crops were 491 to 550 px, so every output (1024 px) was downscaled and no escalation to 2K/4K was exercised. Large crops from high-resolution art are untested.
9. **Source art resolution.** The test scenes are 1254 px, about 105 DPI at a 300 mm page. That is a print limit of the art, not the pipeline (plan section 10 already covers the upscale step).

Not tested in M1 (M2 scope): art text with OCR, collages, age stages, a girl, several different children, Sard's real art, side-by-side against a whole-image edit, parallel load at production volume.

## 6. Recommendation

**Go for M2, conditional on Sard's own review of likeness and style from `report.html`.**

- The core promise holds on all three views: new hero in the story's style, with every pixel outside the mask byte-identical (tested on synthetic images and on the real scenes).
- Automatic QA separates good from bad on the measured data, and unattended success was 18 of 18 after the mask and prompt fixes.
- The main risks are not the model but: mask quality (M3 click-to-mask tooling is essential), one narrow test set (one photo, one art style, ChatGPT art), and trial-project quota.
- Before committing to the 90% unattended objective, M2 should repeat this on Sard's real illustrations with several children's photos, including a girl.

## 7. Reproduce

```bash
corepack pnpm m1                      # full run: 3 scenes x compare models x candidates
corepack pnpm exec tsx scripts/rejudge.ts <run-id>   # re-apply thresholds, no API calls
corepack pnpm dev                     # UI at http://localhost:3000/m1
```
