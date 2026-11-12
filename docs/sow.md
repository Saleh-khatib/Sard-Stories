# Sard Story Books — Statement of Work

Nov 12, 2026 · @Saleh

## 1. Purpose and objectives

This SoW covers building the Sard Story Books production system: a web app that turns a customer's child photo and names into a print-ready personalised storybook, changing only the character in Sard's existing illustrations and leaving every other pixel untouched. The full design is in the [Sard Story Books — UI & Flow Plan](https://claude.ai/artifact/QBzE98TVf9G6TLLvweJ5KD), which forms part of this SoW.

| Objective | Target |
| --- | --- |
| Original art protected | 0 changed pixels outside each character's edit mask, verified automatically |
| Operator time per order | Under 2 minutes of human input (form, character sheet approval, final review) |
| Unattended generation | At least 90% of character edits pass automated QA without operator action |
| New story setup | One import (workbook + images + fonts), then layout confirmation and character tagging in the app |
| Configurability | Every model, prompt, threshold, price and book format editable from Settings, with no code change |
| Print output | Print-ready PDF at the story's page size and bleed, lossless images at 300+ effective DPI on every page, vector text, in English and Arabic (right-to-left) |
| Supported formats | Connected spreads (Christmas sample) and single square pages with text pages (World Cup sample) |

## 2. Scope of work

The work is six modules, built on the existing Next.js 15 app.

| Module | Included |
| --- | --- |
| A. Core image pipeline | Crop → edit → composite through a feathered mask; output size chosen per crop (1K / 2K / 4K); view-specific prompts (front, side, back); age-stage prompts; art text re-lettering (jersey names, cover titles, speech bubbles); N candidates per instance; automated QA (edge similarity, seam, sharpness, vision rubric, OCR for art text); auto-retry and flagging; per-render cost tracking |
| B. Story authoring | Import of the story workbook, images, fonts and optional Canva/Illustrator PDF; validation report by sheet and row; page structure detection (connected spread, single, picture + text, text page, cover) with confirm / split / join; character slots with allowed genders, age stages and name length limits; tagging canvas with suggested boxes, click-to-mask, brush and eraser; instance kinds (character, art text, fixed person); text boxes with styles and tokens; publish check |
| C. Text and token engine | Name, upper-case name, possessive, English pronouns with capitalisation, inline gendered forms for any language; shrink-to-fit in the real font; longest-name test |
| D. Customer orders | Order form with one card per slot and live text preview; photo quality check; feature card extraction; one character sheet per age stage with approve / regenerate; background generation with live status; review with regenerate and version history; inline text edits per order |
| E. Book preview and export | Open-book page-turning preview (cover alone, facing pages, connected spreads, RTL); before/after, print guides, flags and single-page toggles; print PDF via Playwright from the same pages, split at the fold where needed |
| F. Settings and platform | Nine Settings tabs (connection, models, generation, masking, prompts, QA, output and cost, book format, text styles) with versioning and test buttons; Vertex AI connection; admin and operator logins; SQLite + Drizzle; BullMQ job queue; Sentry; Docker Compose deployment on one VPS; Home dashboard with attention list and monthly cost |

## 3. Out of scope

Anything not listed in section 2 is out of scope, including:

- A customer-facing storefront, checkout or payment collection (orders are entered by Sard staff)
- Writing stories, illustrating scenes or designing page layouts
- Converting existing stories into the import workbook (Sard prepares these; the developer converts the two sample books as test data only)
- Printing, binding and shipping, and integration with a print provider's API
- Mobile apps; the web app is for desktop and tablet browsers
- Google Cloud, hosting and AI usage fees (paid by Sard)
- Licensing of real people's likenesses or third-party trademarks used in stories
- Support and maintenance after the warranty period in section 8

## 4. Deliverables

| # | Deliverable | Form |
| --- | --- | --- |
| D1 | Proof-of-concept report: 3-scene test (front, side, back) across candidate models, chosen model and QA thresholds | Short report + before/after images |
| D2 | Working web app covering modules A–F | Source code in Sard's Git repository |
| D3 | Story import template and importer | .xlsx template + validation |
| D4 | Both sample books (Christmas, World Cup) set up in the app and generated end to end for one test child | Published stories + exported PDFs |
| D5 | Production deployment | Running on Sard's VPS with Docker Compose, backups enabled |
| D6 | Documentation | README, setup guide, Settings reference, operator guide (how to add a story and process an order) |
| D7 | Handover session | 2-hour walkthrough, recorded |

## 5. Phases and milestones

The build runs about 11 weeks for one full-time developer, in six milestones that each end in a demo and Sard's acceptance. M1 is a go / no-go: if the proof of concept does not meet Sard's quality bar, the build does not start and only M1 is paid.

| Milestone | Modules | Main work |
| --- | --- | --- |
| M1 Proof of concept | A (part) | Vertex AI setup; crop → edit → composite on 3 real scenes; compare models; set QA thresholds; D1 report |
| M2 Core pipeline | A, C (part) | Full edit pipeline with candidates, QA, retries, art text with OCR, age stages, character sheets, job queue, cost tracking |
| M3 Story authoring | B, C | Importer and validation, page structure, tagging canvas with click-to-mask, text boxes and tokens, publish check; both sample books set up |
| M4 Orders and preview | D, E (part) | Order form, sheet approval, background generation, review with versions, open-book preview |
| M5 Export and platform | E, F | Lossless print PDF with DPI check, master upscaling, ten Settings tabs, logins, Home dashboard, Sentry, VPS deployment |
| M6 Handover | — | End-to-end test of both books, documentation, operator guide, handover session |

Durations are estimates; the developer confirms them after M1, when model behaviour on Sard's art is known.

## 6. Acceptance criteria

Each milestone is accepted when Sard confirms its criteria in writing; Sard reviews within 3 working days, otherwise the milestone is deemed accepted.

| Milestone | Accepted when |
| --- | --- |
| M1 Proof of concept | On 3 real scenes (front, side, back), outside-mask pixels are identical to the original; Sard approves the likeness and style of the results; model and QA thresholds are recorded in D1 |
| M2 Core pipeline | One scene with 3+ instances, including a collage and an art text jersey, generates unattended; OCR reads the new name exactly; failing outputs are retried and flagged; cost per render is recorded |
| M3 Story authoring | Both sample books import from their workbooks; every validation rule rejects a deliberately broken file with sheet and row; layouts are detected and confirmable; all characters are tagged and both stories pass the publish check |
| M4 Orders and preview | An order for each sample book runs from form to review with no more than the two operator gates; the book preview pairs pages correctly for both formats and for an RTL test story |
| M5 Export and platform | Exported PDFs match the preview, use the story's page size and bleed, contain only lossless images with no downsampling, reach at least 300 effective DPI on every page (verified automatically after export), and render a 14-character name and an Arabic page correctly; every Settings field changes behaviour without a code change; app runs on the VPS behind login |
| M6 Handover | D1–D7 delivered; Sard staff add a story and process an order unaided using the operator guide |

"Unattended" success (objective of 90%) is measured over the first 50 production orders and reported, but is not a condition of M6, since it depends on story art and model behaviour.

## 7. Roles, assumptions and dependencies

| Party | Responsible for |
| --- | --- |
| Sard (client) | Product decisions and approvals; original full-resolution story images; font files; filled import workbooks for new stories; printer specs (bleed, gutter, DPI); Google Cloud project with billing and Vertex AI enabled; VPS and domain; test child photos with parental consent |
| Developer | Design, build, test and deploy modules A–F; deliverables D1–D7; weekly progress update with a live demo link |

Assumptions:

- One developer working on the project; durations in section 5 assume full-time availability
- Gemini image models remain available on Vertex AI at roughly current prices and quality; if access to a model is restricted (allowlist, quota), the developer uses the closest available model and records the change
- Story art is supplied at print resolution or Sard accepts the one-time upscale at authoring
- Sard staff review and give feedback within 3 working days per milestone
- Story text is supplied in final form; copy-editing is not included

Dependencies that can delay the plan:

- Vertex AI access and image quota on Sard's Google Cloud project (needed from week 1)
- Original image files and fonts for both sample books (needed by the start of M3)
- Printer specifications (needed by the start of M5)

## 8. Risks, change control, commercials and sign-off

### Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Model likeness or style quality below expectation | Rework, more operator review | M1 proof of concept tests models on real scenes before the build starts; go / no-go at M1 |
| Art text letters wrong on jerseys or titles | Reprinted books | Mandatory OCR read-back; art text never auto-passes on vision score alone |
| Low-resolution source art | Soft print quality | Low-DPI warning; one-time upscale at authoring; Sard supplies originals |
| Vertex preview model access or quota limits | Delays, slower generation | Model ID and concurrency configurable in Settings; fallback model |
| AI cost per book higher than planned | Lower margin | Cost estimate before each order, per-order budget alert, batch mode |
| Real people and trademarks in stories | Legal exposure | Out of scope technically; Sard to clear licensing before selling such stories |

### Change control

Any change to sections 2–6 is requested in writing, estimated by the developer in days and cost, and only started after Sard approves the estimate. Changes found to be needed to meet an existing acceptance criterion are not change requests.

### Commercials

| Item | Value |
| --- | --- |
| Pricing model | \[Fixed price / time and materials — to be agreed\] |
| Total fee | \[To be agreed\] |
| Payment schedule | \[e.g. 20% at signing, 20% at M1, 20% at M3, 20% at M5, 20% at M6\] |
| Warranty | \[30\] days after M6 for defects against the acceptance criteria |
| Ownership | All source code, prompts and templates belong to Sard on final payment |

### Sign-off

|  | Name | Signature | Date |
| --- | --- | --- | --- |
| Sard |  |  |  |
| Developer |  |  |  |
