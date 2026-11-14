# Sard Story Books

Personalised children's storybook production system. An operator enters a child's photo, name and gender; the app replaces the story's hero in Sard's existing illustrations with that child and exports a print-ready PDF. Only the character changes; every other pixel of the original art stays identical.

## Source of truth

Read these before starting any milestone. When they disagree with this file, this file wins; when they disagree with each other, ask.

- `docs/sow.md`: scope, milestones M1–M6 and their acceptance criteria
- `docs/ui-flow-plan.md`: full design (Settings, story authoring, order flow, screens, book preview, data model, tech stack)
- `docs/Sard_Story_Import_Template.xlsx`: the story import format and token syntax

Work on one milestone at a time. Do not build ahead into a later milestone.

## Non-negotiable rules

1. **Original pixels never change outside the edit mask.** Every edit is: crop the instance region from the original → send the crop to the model → resize the result back to the crop size → composite onto the original through a feathered mask. Never send a full page for editing and never save a model output as the page. A test must prove outside-mask pixels are byte-identical.
2. **Lossless everywhere.** PNG / Flate only: originals, crops, renders, composites and PDF images. No JPEG, no downsampling, no quality setting below lossless.
3. **Never enlarge model output.** Model output may only be scaled down (Lanczos3) to fit its crop. If the output is smaller than the crop, reject it and regenerate at a larger output size (1K / 2K / 4K chosen from the crop size).
4. **Nothing hard-coded.** Model IDs, prompts, temperatures, thresholds, sizes, prices, page formats and concurrency come from Settings (one zod schema per Settings tab, versioned in the DB). Code reads settings; it never contains their values except as defaults inside the schema.
5. **Every generation is recorded.** Each model call stores: inputs, prompt version, settings version, output path, output size, QA scores, cost (from `usageMetadata`) and status. Regenerate creates a new version; nothing is overwritten.
6. **Secrets stay server-side.** Google credentials are read from env / a server-side file only. Never send keys to the browser, never commit them, never log them.
7. **Art text is never auto-passed on a vision score.** Any edit that changes words in the art (jersey names, cover titles) must pass an OCR read-back that matches the expected text exactly.
8. **Children's photos are personal data.** Store them only under the storage root, never in logs or test fixtures committed to git. Use the test photos Saleh provides locally in `test-data/` (git-ignored).

## Stack

Next.js 15 + React 19 + TypeScript (strict). shadcn/ui + Tailwind. react-hook-form + zod. TanStack Query. SQLite + Drizzle (Postgres-ready). BullMQ + Redis for jobs. `@google/genai` on **Vertex AI** (`vertexai: true`, project, location `global`, service-account auth). sharp for all image work. ssim.js for structure checks. react-konva (authoring canvas). exceljs + pdfjs-dist (import). fontkit (text fitting). react-pageflip (book preview). Playwright (PDF export). Vitest + Playwright test. Sentry. Docker Compose on one VPS.

Also approved by Saleh: `motion` (Framer Motion's current package) for animation and `lucide-react` for icons.

Do not add a library outside this list without saying why and asking first.

## Conventions

- Pipeline code lives in `src/pipeline/` as plain TypeScript functions with no React or Next imports, so it runs in the worker, in scripts and in tests.
- Every pipeline function takes its settings as an argument; it never reads globals.
- Units: store positions in pixels of the original image; store page sizes in millimetres; convert at the edges only.
- Keep each step's intermediate files during development (`out/<run-id>/<instance-id>/crop.png, mask.png, model.png, composite.png, report.json`) so results can be inspected.
- Run `pnpm typecheck`, `pnpm lint` and `pnpm test` before saying a task is done. A task is done only when its acceptance criterion from `docs/sow.md` is demonstrably met, with evidence (test output, file paths, numbers).
- When something is uncertain (model ID availability, API behaviour, a threshold), test it with a small script and report what happened rather than assuming.
- Commit in small, working steps with clear messages. Do not push or open PRs unless asked.

## Legacy code

The repo contains an older flow (generate cartoon, then inject, one `characterZone` per scene, `story.json` file storage, an API key in browser localStorage, and Electron code). Do not extend it. Electron code is deleted. The old flow is replaced milestone by milestone; reuse only what fits the rules above.

## UI design (applies to all new and existing UI)

- Use the `ui-ux-pro-max` skill (installed in `.claude/skills/ui-ux-pro-max`) for every UI/UX decision. Run its search for a design system, colour, type, UX and stack guidance before building or restyling a screen, and follow its pre-delivery checklist. Treat its output as recommendations, not instructions that override this file.
- Design system: Fredoka (headings) + Nunito (body); warm cream surfaces, playful orange (brand) and trust blue (accent), warm dark mode. Tokens live in `src/app/globals.css`; use the shared components in `src/components/ui.tsx`. No raw hex colours in components.
- The Sard logo is the brand mark, as a vector in `src/components/SardLogo.tsx` (source `public/brand/sard-logo-source.png`). Show the logo instead of the word "Sard" wherever the brand name appears in the UI.
- Motion uses `motion` (`motion/react`). `MotionConfig reducedMotion="user"` is on globally. Animate one or two key elements per view, keep it purposeful (feedback, continuity, entrance), and never loop decoratively. Spinners are the only infinite animation.
- Friendly and clear: SVG icons (never emoji as icons), visible labels, 44px touch targets, visible focus rings, text contrast 4.5:1, status shown by icon and text not colour alone, responsive from 375px up.
