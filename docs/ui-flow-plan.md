# Sard Story Books — UI & Flow Plan

Nov 12, 2026 · @Saleh

## Overview

The app has four areas: Stories (authoring, once per story), Orders (per customer), Settings (every model, API, prompt and threshold, no code edits), and a Home dashboard. The operator's only required actions per order are entering the customer data, approving the character sheet, and a final glance before export.

| Area | Who uses it | How often | What it does |
| --- | --- | --- | --- |
| Home | Operator | Daily | Orders needing attention (flagged QA, awaiting sheet approval), cost this month, credit left |
| Stories | Admin | Once per story | Upload scenes, define character slots, tag every character instance, write text with tokens, validate, publish |
| Orders | Operator | Per customer | Pick story, enter names/genders/photos, approve sheet, auto-generate, review, export PDF |
| Settings | Admin | Rarely | Provider credentials, models per job, generation parameters, prompt templates, QA thresholds, output and cost settings |

Design principles:

- **Nothing hard-coded.** Every value the pipeline reads (model ID, resolution rule, temperature, prompt text, thresholds, prices) comes from Settings, versioned, with a reset-to-default.
- **Human gates are few and fast.** Two gates per order (sheet approval, final glance). Everything else runs unattended and only flagged items come back.
- **Original pixels are never at risk.** The UI never offers an action that writes outside a mask; regenerate always re-runs crop → edit → composite on the original file.
- **Every result is versioned.** Regenerate adds a version; nothing good is ever overwritten.
- **Show cost before spending.** Each order shows estimated cost before generation and actual cost after.

## Settings tab

Settings is split into ten sub-tabs. Every field is saved as a versioned settings record; the pipeline reads the active version, and each order stores the version it ran with so results stay reproducible. Allowed values below follow Google's documented parameters ([js-genai ImageConfig](https://googleapis.github.io/js-genai/release%5Fdocs/interfaces/types.ImageConfig.html), [Vertex AI Gemini 3 Pro Image](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-pro-image)).

### 1. Connection

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| Provider | Vertex AI / AI Studio | Vertex AI | The $300 trial credit only applies on Vertex AI |
| GCP project ID | Text | — | Required for Vertex |
| Location | Text | global | Gemini 3 Pro Image is served from `global` |
| Service account key | JSON file upload | — | Stored encrypted server-side; never sent to the browser |
| AI Studio API key | Secret | — | Fallback provider only |
| Test connection | Button | — | Runs one tiny request and shows model access + which billing it hit |

### 2. Models (one per job)

| Job | Default model | Notes |
| --- | --- | --- |
| Scene edit (the swap) | gemini-3-pro-image-preview | Dropdown of known IDs + "custom ID" field |
| Character sheet | gemini-3-pro-image-preview | Can differ from scene edit |
| Vision QA judge | A Gemini Flash text model | Returns structured JSON |
| Feature card extraction | Same as QA | Kid photo → hair, skin, eyes, features |
| Bbox suggestion (authoring) | Same as QA | Returns boxes as JSON |
| Fallback model | Optional | Used if the main model errors twice |

### 3. Generation parameters

| Field | Allowed values | Default | Notes |
| --- | --- | --- | --- |
| Output size rule | 1K / 2K / 4K by crop size | ≤1024 px → 1K, ≤2048 → 2K, else 4K | Thresholds editable; API default is 1K if unset |
| Force size | Off / 1K / 2K / 4K | Off | Override the rule for testing |
| Aspect ratio | 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9 | Auto | Crops are snapped to the nearest supported ratio so the result maps back without distortion |
| Temperature | 0.0–2.0 | 0.2 (tune in tests) | Lower = less variation |
| topP | 0.0–1.0 | 0.95 | Google default |
| topK | Fixed 64 | — | Shown read-only; not settable on this model |
| Seed | Integer / random | Fixed per order | Verify honoured per model in tests |
| Candidates per instance | 1–4 | 2 | API returns 1 candidate per call, so this runs N parallel calls |
| Person generation | ALLOW\_ALL / ALLOW\_ADULT / ALLOW\_NONE | ALLOW\_ALL | Must be ALLOW\_ALL or child edits get blocked |
| Output format | PNG / JPEG + quality | PNG | MIME type and compression are Vertex-only fields |
| Safety thresholds | Per category | Platform default | Exposed for troubleshooting blocked edits |
| Batch mode | On / Off | Off | 50% cheaper, slower; for non-urgent orders |
| Verify output size | On / Off | On | Rejects results smaller than requested (a 1K downgrade of 2K/4K requests has been reported for gemini-3.1-flash-image on Vertex) |

### 4. Masking and compositing

| Field | Default | Notes |
| --- | --- | --- |
| Crop padding | 15% | Context around the head region |
| Mask feather | 8 px (at 4K) | Soft edge width |
| Seam color-match | On | Light color correction on the border band |
| Max inline image size | 7 MB | Vertex inline limit per file; larger references are downscaled |
| Max reference images | 14 | Vertex limit per prompt; we use 3–4 |

### 5. Prompt templates

Editable text areas with variables (`{hair_color}`, `{skin_tone}`, `{view}`, `{style_notes}`…), a variable picker, version history, and a **Test on sample scene** button that runs the template on a chosen instance and shows before/after.

- Character sheet prompt
- Age stage sheet prompt: the same child shown as a teen or adult, keeping hair, skin tone and face
- Scene edit prompt: front / ¾, side, back (three variants, chosen by the instance's view tag), plus an age-stage line (child / teen / adult)
- Art text prompt: re-letter the masked words with the new name in the same font, colour, perspective and fabric folds
- QA judge rubric prompt
- Feature card extraction prompt
- Bbox suggestion prompt

### 6. Quality control

| Field | Default | Notes |
| --- | --- | --- |
| Structure similarity (edge SSIM) min | Set from test runs | Rejects changed outline, head shape or pose |
| Seam color difference max | Set from test runs | Rejects visible edge |
| Sharpness ratio min | Set from test runs | Generated region vs surrounding original |
| Vision QA score min | Set from test runs | Likeness + feature match + artifacts |
| Max auto-retries per instance | 2 | After that the instance is flagged |
| Final glance gate | On | Turn off only after measured data supports it |

Art text has one extra check that cannot be switched off: OCR must read back the new name letter for letter, or the instance fails, whatever its other scores.

### 7. Output, rate limits and cost

| Field | Default | Notes |
| --- | --- | --- |
| Page size, DPI, bleed | From print template | 300 DPI for print |
| Fonts (per language) | — | Arabic font required if Arabic text |
| Concurrency | 4 parallel calls | Lower if the trial project is rate-limited |
| Requests per minute cap | Off | Throttle to stay under quota |
| Retry backoff | Exponential, 3 tries | For 429/5xx errors, separate from QA retries |
| Price table | Per model × size | Editable, since Google changes prices |
| Per-order budget alert | $10 | Pauses an order that exceeds it |

### 8. Book format and spreads

Defaults are measured from the "Dana and the Stolen Christmas Star" sample: 49 spreads, each 1700.88 × 765 pt, i.e. two pages of 850.44 × 765 pt (about 300 × 270 mm each) with one illustration running across both and live text on top. Every value is editable per story, so a different book size needs no code change.

| Field | Default | Notes |
| --- | --- | --- |
| Layout | Spread (2 pages per illustration) | Spread / single page, set per story and overridable per scene |
| Page size | 300 × 270 mm | One page; the spread is twice the width |
| Gutter zone | 15 mm centred on the fold | Confirm with the printer and binding type |
| Face in gutter | Warn | A tagged head or its mask inside the gutter zone warns at authoring; it would disappear into the binding |
| Bleed | 3 mm | Confirm with the printer |
| Text safe margin | 10 mm from trim and from the gutter | Text boxes outside it are flagged |
| Print resolution | 300 DPI | A full spread is 7087 × 3189 px at 300 DPI |
| Low-resolution warning | Below 300 DPI | Measured on every uploaded or imported scene |
| Export split | Spread as one wide page | Or left and right pages as separate PDF pages, per printer |

### 9. Text styles and fitting

Text is a layer of positioned boxes on each spread, not part of the illustration, so names can change without touching the art. Styles are defined once here and picked per box.

| Style | Example in the sample | Editable properties |
| --- | --- | --- |
| Chapter title | "The Night the Star Disappeared" | Font, size, colour, glow colour and radius, alignment |
| Chapter label | "Chapter 1" | Font, size, colour |
| Dialogue | "Of course I'll help!" | Font, size, colour, glow |
| Narration | "Dana and Pip hurried into the snowy forest." | Font, size, colour, line height, alignment |
| Sound effect | "POOF!" | Font, size, colour |
| Credit | "Written by Sard" | Font, size, colour |

| Field | Default | Notes |
| --- | --- | --- |
| Font library | Upload TTF/OTF | Canva fonts must be uploaded once as files; the PDF only embeds subsets |
| Long-name fitting | Shrink to fit, minimum 80% of the style size | Below that the page is flagged |
| Longest-name test | 14 characters | The publish check renders every page with a name this long |

### 10. Print quality (maximum by default)

File size is not limited; sharpness is. A page prints without blur only if its art has at least 300 pixels per inch at print size, so the pipeline protects pixels at every step and refuses to export a page that would print soft.

| Field | Default | Notes |
| --- | --- | --- |
| Quality preset | Maximum | Maximum / Standard (for proofs sent by WhatsApp or email) |
| Image encoding in PDF | Lossless (PNG / Flate) | No JPEG anywhere in the pipeline: originals, crops, renders and PDF |
| Downsampling | Off | Images are embedded at their full pixel count |
| Minimum effective DPI | 300 | Measured per page at print size; export is blocked below it |
| Required master size | Calculated per story | 210 mm page + 3 mm bleed = 2516 px square; 600 × 270 mm spread + bleed = 7158 × 3260 px |
| Upscale masters | On, once at authoring | Real-ESRGAN (or an approved external upscale) to the required master size; the admin approves each upscaled scene, which then becomes the fixed original |
| Resize method | Lanczos3, downscale only | Model output is only ever scaled down to fit its crop; an output smaller than its crop is rejected, never enlarged |
| Text | Vector | Text stays as fonts in the PDF, so it is sharp at any zoom |
| Colour | RGB, or CMYK with the printer's ICC profile | CMYK conversion via Ghostscript (PDF/X) only if the printer asks for it |
| Export check | On | After export, every embedded image is read back and its pixel size, DPI and encoding are verified against these settings |

Upscaling the masters raises the crop sizes, so more instances generate at 2K or 4K: expect the per-book AI cost to rise accordingly.

## Story authoring flow

A story is built once in a five-step wizard and can only be published when validation passes, so every order starts from a story that is known to be complete. The wizard saves as a draft at every step.

1. **Story details and book format** (everything the rest of the wizard depends on)
   - Title, theme (F1, World Cup…), language, target age
   - Style notes: 1–2 lines describing the art style, injected into every prompt
   - Page size, bleed, gutter width and print DPI, prefilled from Settings and editable for this story
   - Default layout: connected spreads, single pages, or mixed. It only sets the starting guess; each scene can still differ
   - Reading direction: left-to-right or right-to-left. Arabic books run right-to-left, which flips which half of a spread is page 1
   - Cover type: none, front only, or wrap-around (back, spine, front)
2. **Import and page structure**
   - Import the Canva PDF directly, or upload images. The importer separates each illustration from its text boxes (position, font, size, colour)
   - The importer detects each scene's layout using the rules below and shows its guess as a badge on every thumbnail
   - The admin confirms or changes each one with a layout picker, and can **Split** a spread into two pages or **Join** two pages into one spread
   - Page numbers are assigned automatically from the confirmed layouts and the reading direction
   - The story strip at the bottom shows the book as it will be printed: connected spreads as one wide card, single pages as halves, the fold drawn on each
   - Pick 2 scenes as style references for character sheets
3. **Character slots**
   - Define who can be personalised: `hero` (required), `friend1`, `friend2`, `sibling`…
   - Per slot: default name, default gender, allowed genders, age stages used in the story (child / teen / adult), personalisation rule (required / optional / never)
   - Optional slots keep the original drawing if the customer leaves them empty
4. **Tag character instances (per scene)**
   - Click **Suggest** → the bbox model proposes boxes; accept, adjust or delete each
   - Click on a head → SAM draws the mask; brush to add, eraser to remove
   - Per instance set: kind (character / art text / fixed person), slot, age stage, view (front / ¾ / side / back), visible features (face, hair, skin). Art text instances also store the exact words they contain, e.g. "SALEH 26"
   - Several instances per image are allowed (collages, the hero appearing twice)
   - The fold is drawn on connected spreads, so a head in the gutter is visible while tagging
   - A side panel lists every instance in the story; untagged scenes are highlighted in red
   - Crop preview shows exactly what will be sent to the model, already snapped to a supported aspect ratio
5. **Story text**
   - Text boxes positioned on the scene (imported from the PDF or drawn), each with a style from Settings and a live preview using sample names
   - Each box knows which page it sits on, so text that crosses the fold or the safe margin is flagged
   - Insert tokens from a picker instead of typing them (rules below)
   - Toggle **Preview as boy / girl** per slot to check every gendered sentence

### Page structure: how layouts are detected

Every scene gets one of five layouts. Detection is automatic but always confirmed by the admin, because the cost of a wrong guess is a printed book cut in the wrong place.

| Layout | Pages | What the importer looks for | What changes downstream |
| --- | --- | --- | --- |
| Connected spread | 2 (left + right) | One illustration covers the full width of a double-width sheet | Gutter check applies; text boxes are assigned to a side; export splits the art at the fold |
| Two single pages | 2 | A double-width sheet holding two separate illustrations, each inside one half | Each half becomes its own scene; no gutter check |
| Single page | 1 | A page-width sheet, or an image whose aspect ratio matches one page | No gutter check |
| Picture + text page | 2 | One half has an illustration, the other only text or a plain background | Only the illustrated half is tagged |
| Text page | 1 | A single page with text over a decorative background and no character art (the World Cup sample's even pages) | Not tagged and costs nothing to generate; only its text tokens change |
| Cover (wrap-around) | Back + spine + front | First sheet of the PDF, or marked by the admin | Spine width set from page count and paper; front cover title holds the hero's name |

The signals, in order:

1. **Sheet size.** A PDF sheet about twice the page width (the sample's 1700.88 × 765 pt) is a double; about one page wide is a single.
2. **Image placement.** On a double sheet, the PDF records where each image sits: one image spanning the fold means connected; images confined to each half mean two singles.
3. **Aspect ratio** for uploaded images with no PDF: about twice the page ratio means spread, about equal means single.
4. **Fold continuity** as a tie-breaker: compare the pixel columns either side of the centre line. Smooth continuation means connected; a hard edge or border means two pages.

### What the World Cup sample adds

The "Saleh's World Cup Dream" sample is a different format from the Christmas book, and it needs four capabilities the plan did not yet have. It has 68 square single pages of 595 × 595 pt (210 × 210 mm), made in Illustrator, with illustration pages and text pages alternating, so it imports as single pages and text pages with no spreads.

| What the sample shows | Example | What the app needs |
| --- | --- | --- |
| The name is drawn into the art | "SALEH 26" on the jersey back, the cover title "SALEH'S WORLD CUP DREAM", speech bubbles such as "I will play in this World Cup!" | A second instance kind, **art text**: a masked region whose words are re-lettered with the new name in the same style, then checked by reading it back (OCR) letter for letter |
| The hero ages through the story | A young boy on page 3, a teenager in the academy, a grown player at the World Cup | **Age stages** on the slot (child, teen, adult). Each instance is tagged with its stage, and the order generates one approved character sheet per stage |
| Many illustrations are collages | 2 to 4 panels per page, the hero in each | Already covered: several instances per image, each with its own crop and age stage |
| Real people who must never change | Teammates, coaches, famous players | A **fixed person** tag: the suggester stops proposing them and the edit masks can never overlap them |
| The story only works for one gender | A boy's football team throughout | **Allowed genders** per slot; the order form only offers those |
| Art resolution | 1024 × 1024 px on a 210 mm page, about 124 DPI | Same low-resolution warning and upscale-at-authoring option as the Christmas book |

Art text is the riskiest edit in the pipeline: a single wrong letter on a jersey is a reprint. It always gets the OCR check, its own retry budget, and is never auto-passed on a vision score alone.

One risk outside the pipeline: this story uses real players' names and likenesses and the World Cup name in a product that is sold. Check the licensing position before selling it.

### Story import file

Every story is delivered as one zipped folder and imported in a single step; the wizard then opens with everything prefilled, so the admin only confirms layouts and tags characters. The folder holds:

- `story.xlsx`: the story workbook (template: Sard\_Story\_Import\_Template.xlsx)
- `images/`: one file per scene, at the highest resolution available, not extracted from the PDF
- `fonts/`: every font named in the Styles sheet
- `layout.pdf` (optional): the Canva or Illustrator PDF, used only to read text box positions

| Sheet | One row per | Key columns |
| --- | --- | --- |
| Story | Book setting | story\_id, title, language, reading\_direction, page size, bleed, gutter, default\_layout, cover\_type, style\_notes |
| Slots | Personalisable character | slot, default\_name, allowed\_genders, age\_stages, name\_max\_length |
| Scenes | Illustration file | scene, image\_file, layout, pages ("4" or "12-13"), characters ("hero:child") |
| Text | Text box | scene, box, page, style, text with tokens, text\_ar, optional position in mm |
| ArtText | Words drawn in the art | scene, where, original\_words, new\_words |
| Styles | Text style | font\_file, size, colour, glow, align, min\_shrink\_pct |
| Tokens | Reference only | Every token with its boy and girl output |

The importer rejects the file, listing every problem with sheet and row, when:

- a slot's default name appears as plain words in Text or ArtText instead of a token
- a token names a slot that does not exist, or a gendered word lacks its girl or boy form for a slot that allows both
- an image file, font or page number is missing, duplicated or out of sequence
- an art text name could exceed name\_max\_length

Names on the order form are checked against name\_max\_length, so a name too long for a jersey is caught when it is typed, not after generation.

### Token rules for names and gender

| Need | Token | Boy / girl output |
| --- | --- | --- |
| Name | `{hero}` | Saleh / Dana |
| Name in capitals (jerseys, titles) | `{HERO}` | SALEH / DANA |
| Possessive | `{hero}'s` | Saleh's / Dana's |
| English pronouns (capital letter in the token = capital output) | `{hero.he}` `{hero.He}` `{hero.him}` `{hero.his}` `{hero.hers}` `{hero.himself}` | he / she, He / She, him / her, his / her, his / hers, himself / herself |
| Any gendered word, any language | `{hero:boy form\|girl form}` | `{hero:son\|daughter}`, `{hero:كان\|كانت}` |
| Side character | Same tokens with its slot | `{friend1}`, `{friend1.his}`, `{friend1:boy\|girl}` |

The inline male/female form is what makes Arabic work: verbs, adjectives and pronouns agree with gender, so plain name substitution would produce broken sentences.

Imported text is converted to tokens by the admin, never by blind find-and-replace: in the sample, "Dana" is both the hero and the designer credit "Designed by Dana Jarrah". The importer highlights every occurrence of the default name and the admin confirms each one.

### Validation before publish

- [ ] Every scene has at least one tagged instance (or is explicitly marked as having no character)
- [ ] Every instance has a slot, a view and a mask
- [ ] No tagged head or mask sits in the gutter zone
- [ ] Every token in the text refers to an existing slot, and no imported name was left as plain text
- [ ] Text previewed for every gender combination of required slots, and with the longest-name test
- [ ] Every scene meets the print resolution, or the warning is accepted
- [ ] One test order run on a sample photo passes QA

## Customer order flow

An order takes the operator about a minute: fill one form, approve one character sheet, glance at the finished book. Generation, QA and retries run on their own; only instances that fail every retry come back.

Order flow (operator gates marked **GATE**):

1. Enter story, names, genders, photos
2. Feature card + character sheet generated
3. **GATE 1**: operator approves sheet? No → regenerate (back to 2). Yes → continue
4. Edit every instance in parallel: crop, edit N candidates, composite
5. Automated QA passes? Yes → 7. No → retries left? Yes → back to 4. No → 6
6. Flag to operator (operator fixes it), then 7
7. Assemble pages with names and text
8. **GATE 2**: final glance in book preview, export PDF

A failed instance retries automatically up to the limit in Settings; only then does it reach the operator, who fixes it before the final glance.

### Step 1 — New order form

- **Story**: card grid of published stories with cover, theme and page count
- **Customer**: name, phone, delivery notes (stored on the order)
- **One card per character slot**, generated from the story's slots:
  - Name (Arabic and/or English, matching the story language)
  - Gender: boy / girl (drives every gendered token)
  - Photo upload with a quality check: face detected, minimum resolution, not blurry; warns before you continue
  - Optional slots show a toggle **Keep original character**
- **Live text preview**: page text re-renders as names and genders are typed, so wrong agreement is caught here
- **Estimated cost** for this order, from the price table and the story's instance count

### Step 2 — Character sheet (gate 1)

- For each personalised slot: kid photo, feature card (editable fields: hair color, hair style, skin tone, eyes, features) and the generated sheet side by side
- Actions: **Approve**, **Regenerate**, or edit a feature card field and regenerate
- Generation only starts when every slot is approved

### Step 3 — Automatic generation

- Progress view: a grid of every instance with status (queued, generating, QA, passed, retrying, flagged)
- Runs in the background; the operator can close the page and come back
- Flagged instances show the QA reason (e.g. "outline changed", "hair color mismatch")

### Step 4 — Review and final glance (gate 2)

- Book preview (see Screens): the personalised book shown open with facing pages, flagged spreads highlighted in the thumbnail strip
- Click a page → full-size view with a before/after slider (original vs personalised)
- Per instance: **Regenerate**, version history, pick a previous version
- Per page: edit text inline (overrides the template for this order only)
- **Approve and export** stays disabled until no instance is flagged

### Step 5 — Export

- Print-ready PDF from the print template, with page count and file size shown
- Order marked done, with actual cost recorded

## Screens

Thirteen screens cover the whole app. Navigation is a left sidebar (Home, Stories, Orders, Settings); wizards show a step bar at the top and keep a sticky footer with Back / Save draft / Next.

| Screen | Key elements | States to design |
| --- | --- | --- |
| Home | Attention list (sheets awaiting approval, flagged orders), monthly cost, credit remaining, recent orders | Empty, normal, budget warning |
| Stories list | Cards with cover, status (draft / published), page count, instance count, last edited | Empty, drafts only |
| Story wizard 1 — Details | Title, theme, language, age, style notes, page size, bleed, gutter, default layout, reading direction, cover type | Validation errors |
| Story wizard 2 — Scenes | PDF or image drop zone, thumbnails with detected-layout badges, layout picker, Split / Join, auto page numbers, printed-book preview strip, style reference picker | Importing, layout unconfirmed, low resolution warning |
| Story wizard 3 — Slots | Slot list with name, gender, rule (required / optional / never) | At least one required slot |
| Story wizard 4 — Tagging | Canvas (react-konva) with boxes and masks, Suggest button, brush/eraser, instance side panel, crop preview | Untagged scene, suggestion loading, SAM loading |
| Story wizard 5 — Text | Per-page editor, token picker, boy/girl preview toggles, page preview | Unknown token, missing gender form |
| Story publish check | Validation checklist, Run test order button | Blocking items, passed |
| Orders list | Table with customer, story, status, cost, created date, filters by status | Empty, filtered |
| New order form | Story picker, customer fields, one card per slot, live text preview, cost estimate | Photo quality warning, optional slot skipped |
| Sheet approval | Photo, editable feature card, sheet, Approve / Regenerate per slot | Generating, regenerated, approved |
| Generation and review | Instance grid with statuses, contact sheet, page view with before/after slider, version history, inline text edit, Approve and export | Running, flagged, all passed, exporting |
| Settings | Ten sub-tabs (see Settings tab), Test connection, Test on sample scene, version history with restore | Unsaved changes, test failed |

Status colours are used consistently on every screen: grey queued, blue running, green passed, amber retrying, red flagged.

### Book preview

Both the imported story and every customer order are previewed as an open book: two facing pages side by side, turned like real pages, so the reader sees exactly what the printed book will look like. It appears in three places: after import (Story wizard step 2), in the publish check, and in order review (Step 4).

How pages are paired into the open book:

- The front cover shows alone, closed, like a book on a table; the first click opens it
- After the cover, page 2 sits on the left and page 3 on the right, then 4–5 and so on, which is how a printer binds them
- A connected spread fills both sides as one continuous picture, split at the fold
- Single pages pair with their neighbour, so the World Cup book shows each text page facing its illustration
- Right-to-left books open from the other side and turn pages the other way
- The back cover shows alone at the end

What the preview shows:

- A soft shadow down the fold and a slight page curl when turning, so a face sitting in the gutter is visibly lost, as it would be in print
- The final text with the customer's names, rendered by the same page renderer that produces the PDF, so preview and print cannot differ
- Thumbnail strip of all spreads below the book; click to jump
- Keyboard arrows and swipe to turn; full-screen mode for showing a customer

Toggles on the preview toolbar:

| Toggle | What it does |
| --- | --- |
| Before / after | Flips between the original story art and the personalised version on the open spread |
| Print guides | Draws bleed, trim, gutter zone and text safe margin over the pages |
| Flags | Outlines instances that failed QA in red, with the reason on hover |
| Single page | Shows one page at a time, for checking a page at full size |

In order review, each open spread keeps its actions: regenerate an instance, pick a previous version, edit text. The book updates in place, without reloading.

Built with `react-pageflip` (StPageFlip) for the page turning; each page is the HTML page that is also printed, so no second layout is maintained.

## Tech stack

One TypeScript codebase on the existing Next.js 15 app, chosen for the widest library support and the least to learn: every layer below is a mainstream, well-documented library.

| Layer | Choice | Why |
| --- | --- | --- |
| App framework | Next.js 15 + React 19 + TypeScript (keep) | Already in use; UI and API in one project |
| UI components | shadcn/ui + Tailwind CSS + lucide-react icons | Copy-in components (tables, dialogs, tabs, forms) you fully own and restyle |
| Forms and settings | react-hook-form + zod | One zod schema per settings tab drives the form, validation and defaults |
| Data fetching | TanStack Query | Live job progress, caching, retries in the UI |
| Database | SQLite + Drizzle ORM, PostgreSQL later | Zero setup now; same code moves to Postgres by changing the driver |
| Background jobs | BullMQ + Redis | Parallel instance jobs, retries, progress, survives restarts |
| Image AI | @google/genai on Vertex AI | Scene edits, character sheets, QA, OCR read-back, bbox suggestions |
| Image processing | sharp | Crop, composite, feather mask, sharpness and seam checks |
| Similarity check | ssim.js | Structure check inside the mask |
| Authoring canvas | react-konva | Boxes, masks, brush and eraser on scenes |
| Click-to-mask | SAM via transformers.js (in browser) or fal.ai | Mask from one click on a head |
| Upscaling originals | Real-ESRGAN via Replicate or fal.ai | One-time upscale of low-resolution story art at authoring |
| Story import | exceljs (workbook) + pdfjs-dist (text positions and images from the PDF) | Reads the import template and the Canva/Illustrator PDF |
| Text fitting | fontkit | Measures names in the real font for shrink-to-fit and length limits |
| Book preview | react-pageflip | Page-turning open-book view |
| PDF export | Playwright (headless Chromium) | Same HTML pages as the preview, correct Arabic shaping and RTL |
| File storage | Local disk, then Cloudflare R2 | Originals, crops, renders, versions; R2 has no download fees |
| Auth | Auth.js | Admin and operator logins |
| Errors and logs | Sentry | Failed jobs and API errors in one place |
| Tests | Vitest + Playwright test | Unit tests for tokens and compositing; end-to-end for the order flow |
| Hosting | One VPS (e.g. Hetzner or DigitalOcean) with Docker Compose: app, worker, Redis | Long image jobs and Playwright do not fit serverless time limits |

## Data model and open decisions

Nine tables carry the whole flow, stored in SQLite (Drizzle); images stay on disk, later R2/S3.

| Table | Key fields |
| --- | --- |
| Story | id, title, theme, language, style\_notes, style\_refs, status |
| Scene | id, story\_id, order, layout (connected spread / single / picture + text / cover), page\_left, page\_right, original\_path, width, height, source\_dpi |
| CharacterSlot | id, story\_id, key (hero, friend1…), default\_name, default\_gender, rule |
| Instance | id, scene\_id, kind, slot\_id, age\_stage, bbox, mask\_path, view, features, art\_text, crop\_ratio |
| TextBlock | id, scene\_id, template (with tokens) |
| Order | id, story\_id, customer, status, settings\_version, est\_cost, actual\_cost |
| ChildProfile | id, order\_id, slot\_id, name, gender, photo\_path, feature\_card, sheets (one per age stage, each with its approval status) |
| SceneRender | id, order\_id, instance\_id, version, candidate, status, qa\_scores, qa\_reason, output\_size, cost, path, selected |
| SettingsVersion | id, created\_at, values (JSON), active |

### Open decisions

- [ ] Story language: the Christmas sample is English. Confirm whether Arabic editions are planned, since they need Arabic fonts and HTML → PDF via Playwright
- [ ] Source art resolution: the sample's illustrations are about 1870 × 840 px per spread (around 79 DPI at print size). Get the original files at higher resolution, or upscale each original once at authoring
- [ ] Main model after the 3-scene test: Pro vs Nano Banana 2 for crops above 1K
- [ ] QA threshold values, set from the 3-scene test results
- [ ] Whether side characters are personalised with their own photo or only renamed
- [ ] Vertex trial quota: confirm image RPM is high enough for parallel runs
- [ ] Gutter width and bleed from the printer

## Sources

- [js-genai ImageConfig reference](https://googleapis.github.io/js-genai/release%5Fdocs/interfaces/types.ImageConfig.html)
- [Vertex AI: Gemini 3 Pro Image model page](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-pro-image)
- [Geminix ImageConfig (aspect ratio and size defaults)](https://hexdocs.pm/geminix/Geminix.V1beta.ImageConfig.html)
- [Forum: gemini-3.1-flash-image downgrades 2K/4K to 1K on Vertex](https://discuss.google.dev/t/vertex-ai-gemini-3-1-flash-image-preview-downgrades-2k-4k-requests-to-1k/341077)
- [Google Cloud Free Trial terms](https://docs.cloud.google.com/free/docs/free-cloud-features.md.txt)
