# M2 core pipeline report

Runs on 14 Nov 2026. Everything below is measured. Evidence: `out/m2/<order>/report.html`, `summary.json`, and the `scene_renders` table in `storage/app.sqlite`.

## 1. Acceptance (docs/sow.md section 6)

> One scene with 3+ instances, including a collage and an art text jersey, generates unattended; OCR reads the new name exactly; failing outputs are retried and flagged; cost per render is recorded.

| Criterion | Result | Evidence |
| --- | --- | --- |
| One scene, 3+ instances, collage + art text jersey | Met: 4 instances in a 3-panel collage (child front, teen side, adult back, shirt print) | `test-data/m2/manifest.json`; the scene is **synthetic**, generated for testing, not Sard art |
| Unattended | Met: order `m2-2026-11-14T16-15-37-073Z` ran sheets, 4 instances, QA and compositing through the BullMQ/Redis queue with no human step. 413 s, 4 of 4 passed | `out/m2/m2-2026-11-14T16-15-37-073Z/report.html` |
| OCR reads the new name exactly | Met: both OCR models read "SALEH 7" (exact, case and digits). Art text can only pass on an exact read-back from every OCR model; the vision judge is never consulted for it | `tests/m2.test.ts`, report |
| Failing outputs retried and flagged | Met: order `m2-2026-11-14T15-56-11-112Z` ran 3 rounds (a new version each, with the failure reasons added to the prompt) and flagged 3 instances for the operator, leaving their original pixels untouched | report, `scene_results.flagged_instances` |
| Cost per render recorded | Met: every candidate is a `scene_renders` row with inputs, prompt version, settings version, output path and size, QA scores, cost, time, status and selected flag. Failed calls are recorded at $0 | DB |
| Outside-mask pixels identical | Met on both runs: byte-identical outside the union of edited masks (checked after compositing; the run throws if not) | `scene_results.outside_union_identical` |

## 2. What was built

- **Database** (Drizzle + SQLite, Postgres-ready): settings versions, scenes, instances (character, art text, fixed person), orders, child profiles, renders, scene results. Settings now live in the DB as versions; saving adds a version, and every render stores the version it ran with.
- **Instance processor**: N candidates, QA, a new round when none passes (up to `maxAutoRetries`), flag after the last round. A flagged instance keeps its original pixels; the best failed attempt is saved for review.
- **Collage**: every instance crops from the untouched original and passes through its own mask. Masks that overlap each other or a fixed-person mask are refused before any model call.
- **Age stages**: the base sheet is made from the photo, then teen and adult sheets are derived from it. Scene prompts get an age line.
- **Art text**: re-lettering prompt plus OCR read-back from every model in Settings (`models.ocr`), letter for letter.
- **Approval gate**: sheets start unapproved and scene generation refuses to run until they are approved (the operator UI is M4; unattended runs pass `autoApprove`).
- **Queue**: BullMQ on Redis: a `sheets` job per order that fans out one `scene` job per scene, with retries, the order's own settings version, and a shared limiter for model calls. `scripts/worker.ts` runs it as a long-lived worker.
- **Cost**: per render, per instance, per order (sheets included).

## 3. Results

| | Run 1 (15:56) | Run 2 (16:15) |
| --- | --- | --- |
| Status | flagged | done |
| Instances passed | 1 of 4 | 4 of 4 |
| Renders recorded | 20 (1 ok, 15 failed QA, 4 rate-limited) | 8 (7 ok, 1 rate-limited) |
| Cost | $1.591 | $0.935 |
| Time | 992 s | 413 s |

Run 2 cost breakdown: sheets (child, teen, adult) $0.42, instances $0.51 (head edits about $0.146 each with 2 candidates and the judge, shirt print $0.077).

The two runs differ because of what run 1 found (section 4), not because of luck: the QA rule and one mask were fixed in between.

## 4. Problems found

1. **The absolute sharpness gate was wrong.** Fitted in M1 on faces against sky and trees (minimum 2.0), it flagged correct results here: the adult head against a stadium crowd scored 1.22 and the shirt print 1.83, both visually perfect. In M1 it only "worked" because the known-bad samples happened to have scores near their original's. It measures the scene, not the result. Replaced, in M1 and M2, by a relative rule: the new region's sharpness divided by the original region's, minimum **0.5**. Calibration: good results 0.73 to 1.39 (M1 and M2), the same good results blurred by only σ=1 drop to 0.17 to 0.23. The M1 run still passes 18 of 18 under the new rule, and the thresholds in `docs/m1-report.md` section 4 are superseded on this point.
2. **Retries cannot fix a mask defect.** The teen mask missed a tuft of the original hair. All 3 rounds failed for the same reason, correctly flagged by the judge ("leftover brown hair strand"), at a cost of about $0.37. Mask quality decides outcomes more than the model does, which is the case for the click-to-mask tool in M3. A cheap guard is worth adding: stop retrying when the same failure reason repeats unchanged and report "check the mask".
3. **Rate limits (429).** 5 of 28 image calls hit the trial quota, all recorded at $0 and absorbed by having 2 candidates per instance. Production volume needs a quota increase.
4. **Re-importing a scene broke on history.** Deleting and recreating instances conflicted with recorded renders (correctly refused by the database). Instances are now updated in place and only removed when nothing references them. Regression test added.
5. **BullMQ 6 needs `ioredis` installed explicitly**; without it the connection retried in a tight loop and exhausted memory. Installed; documented here.
6. **Settings versions and code defaults.** Both orders show settings v1, but run 1 used the old absolute sharpness rule that was in code. A threshold change must be saved as a new settings version; v2 now records the relative rule explicitly.

## 5. Not covered (by scope or by test data)

- The scene is synthetic and was made in the same style as the earlier test art. Sard's real illustrations have not been tested.
- One child photo, one gender, Latin capitals and digits on the shirt. Arabic art text and longer names (14 characters) are not tested.
- Speech bubbles and cover titles use the same art-text path but were not run.
- No order screen or operator approval UI (M4); no story import or tagging UI (M3). Masks for this scene were proposed by Gemini and adjusted by hand.
- Fixed-person masks are enforced (no overlap) but were only exercised in tests, not in a real run.
- Redis is installed locally with Homebrew; the VPS setup (Docker Compose) is M5.

## 6. Recommendation

M2 meets its acceptance criterion. The riskiest remaining items for M3 are mask creation and Sard's real art. Suggested next: the click-to-mask tool and story tagging (M3), then order screens with the sheet approval gate (M4).

## 7. Run it

```bash
brew services start redis
corepack pnpm exec tsx scripts/m2-run.ts      # acceptance scene, unattended, writes out/m2/<order>/report.html
corepack pnpm exec tsx scripts/worker.ts      # long-running worker
corepack pnpm test                            # 48 tests, including a real Redis queue run with a fake model
```
