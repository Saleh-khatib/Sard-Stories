import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { composite } from "../src/pipeline/composite";
import { cropInstance } from "../src/pipeline/crop";
import { cropBinary, extractPng, readMaskBinary } from "../src/pipeline/maskops";
import { edgeSimilarity, outsideMaskDiff, seamDelta, sharpnessRatio } from "../src/pipeline/qa";
import { renderReport } from "../src/pipeline/report";
import { judgeVerdict, type CandidateReport, type RunStatus, type RunSummary, type SceneReport } from "../src/pipeline/runM1";
import { SCENE_NAMES } from "../src/pipeline/inputs";
import { M1SettingsSchema } from "../src/settings/schema";

// Synthetic demo: no API calls, no real art. Lets you look at the UI and report layout.
const settings = M1SettingsSchema.parse({});
const runId = "demo-synthetic";
const runDir = join("out/m1", runId);
const models = ["demo-model-A", "demo-model-B"];
const W = 1600, H = 1100;

async function art(seed: number): Promise<Buffer> {
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9ad1ff"/><stop offset="1" stop-color="#ffe3a8"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/><rect y="800" width="${W}" height="300" fill="#6bbf6b"/>
<rect x="640" y="520" width="320" height="420" rx="40" fill="#3a6fd8"/><circle cx="800" cy="400" r="150" fill="#f1c9a5" stroke="#222" stroke-width="6"/>
<circle cx="750" cy="390" r="14" fill="#222"/><circle cx="850" cy="390" r="14" fill="#222"/><path d="M740 460 Q800 ${500 + seed * 10} 860 460" stroke="#222" stroke-width="8" fill="none"/>
<path d="M650 330 Q800 190 950 330" fill="#5a3a22"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
async function maskPng(): Promise<Buffer> {
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#000"/><ellipse cx="800" cy="390" rx="170" ry="190" fill="#fff"/><rect x="740" y="520" width="120" height="50" fill="#fff"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
async function fakeModelOutput(w: number, h: number, hair: string): Promise<Buffer> {
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#bfe0ff"/>
<circle cx="${w / 2}" cy="${h * 0.48}" r="${h * 0.3}" fill="#e0a878" stroke="#222" stroke-width="5"/><path d="M${w * 0.25} ${h * 0.4} Q${w / 2} ${h * 0.05} ${w * 0.75} ${h * 0.4}" fill="${hair}"/>
<circle cx="${w * 0.42}" cy="${h * 0.48}" r="${h * 0.02}" fill="#222"/><circle cx="${w * 0.58}" cy="${h * 0.48}" r="${h * 0.02}" fill="#222"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

await mkdir(runDir, { recursive: true });
await mkdir(join(runDir, "sheet"), { recursive: true });
await writeFile(join(runDir, "sheet", "sheet.png"), await fakeModelOutput(900, 600, "#2b1b10"));
const status: RunStatus = { runId, state: "done", startedAt: new Date().toISOString(), total: SCENE_NAMES.length * models.length * 2, done: 12, current: "finished", error: null };
await writeFile(join(runDir, "status.json"), JSON.stringify(status, null, 2));

const scenes: SceneReport[] = [];
for (const [si, scene] of SCENE_NAMES.entries()) {
  const orig = await art(si);
  const mask = await maskPng();
  const box = await cropInstance(orig, mask, { paddingPct: settings.masking.cropPaddingPct, maskThreshold: settings.masking.maskThreshold });
  const m = await readMaskBinary(mask, settings.masking.maskThreshold);
  const maskCrop = cropBinary(m.bin, m.width, box);
  const origCrop = await extractPng(orig, box);
  const dir = join(runDir, scene);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "original.png"), orig);
  await writeFile(join(dir, "mask.png"), mask);
  await writeFile(join(dir, "crop.png"), origCrop);
  await writeFile(join(dir, "outlined.png"), origCrop);
  const sr: SceneReport = {
    scene, view: scene, box, sceneSize: [W, H], instanceMs: {},
    files: { original: `${scene}/original.png`, mask: `${scene}/mask.png`, crop: `${scene}/crop.png`, outlined: `${scene}/outlined.png` },
    candidates: [],
  };
  for (const [mi, model] of models.entries()) {
    sr.instanceMs[model] = 9000 + mi * 4000;
    for (let n = 1; n <= 2; n++) {
      const cdir = join(dir, model, String(n));
      await mkdir(cdir, { recursive: true });
      const raw = await fakeModelOutput(box.width * 1.5, box.height * 1.5, n === 1 ? "#2b1b10" : "#c98a2b");
      await writeFile(join(cdir, "raw.png"), raw);
      const comp = await composite(orig, raw, mask, box, settings);
      if (!comp.ok) throw new Error(comp.reason);
      await writeFile(join(cdir, "composite.png"), comp.image);
      const crop = await extractPng(comp.image, box);
      await writeFile(join(cdir, "composite-crop.png"), crop);
      const diff = await outsideMaskDiff(orig, comp.image, mask, settings.masking.maskThreshold);
      const qa = {
        outsideIdentical: diff.identical, outsideDiffBytes: diff.differingBytes,
        edgeSsim: await edgeSimilarity(origCrop, crop, maskCrop, box.width, box.height, settings.masking),
        seamDelta: await seamDelta(crop, maskCrop, box.width, box.height, settings.masking),
        seamDeltaBaseline: await seamDelta(origCrop, maskCrop, box.width, box.height, settings.masking),
        sharpnessRatio: await sharpnessRatio(crop, maskCrop, box.width, box.height, settings.masking),
        sharpnessBaseline: await sharpnessRatio(origCrop, maskCrop, box.width, box.height, settings.masking),
        vision: { likeness: 6 + mi + n, featureMatch: 7, styleMatch: 5 + mi * 2, overall: 5 + mi * 2 + (n - 1), artifacts: [], extraFaces: false, pass: mi === 1, reason: "SYNTHETIC DEMO DATA, not a real judgement" },
        visionError: null,
      };
      const rep: CandidateReport = {
        scene, model, n, status: "ok", reason: null, requestedSize: "1K", outputSize: [Math.round(box.width * 1.5), Math.round(box.height * 1.5)],
        attempts: [], aspectErrorPct: comp.aspectErrorPct, seamShift: comp.seamShift, qa, verdict: judgeVerdict(qa, settings.qa),
        costUsd: 0.14 + mi * 0.07, genMs: 6000 + n * 1000,
        files: { raw: `${scene}/${model}/${n}/raw.png`, composite: `${scene}/${model}/${n}/composite.png`, compositeCrop: `${scene}/${model}/${n}/composite-crop.png` },
      };
      await writeFile(join(cdir, "report.json"), JSON.stringify(rep, null, 2));
      sr.candidates.push(rep);
    }
  }
  scenes.push(sr);
}
const totals = models.map((model) => {
  const cs = scenes.flatMap((s) => s.candidates.filter((c) => c.model === model));
  const mean = (f: (c: CandidateReport) => number) => cs.reduce((a, c) => a + f(c), 0) / cs.length;
  return {
    model, candidates: cs.length, passed: cs.filter((c) => c.verdict.pass).length, rejected: 0, errors: 0,
    costUsd: cs.reduce((a, c) => a + c.costUsd, 0), avgInstanceMs: scenes.reduce((a, s) => a + (s.instanceMs[model] ?? 0), 0) / scenes.length,
    avg: { edgeSsim: mean((c) => c.qa!.edgeSsim), seamDelta: mean((c) => c.qa!.seamDelta), sharpnessRatio: mean((c) => c.qa!.sharpnessRatio),
      visionOverall: mean((c) => c.qa!.vision!.overall), likeness: mean((c) => c.qa!.vision!.likeness), styleMatch: mean((c) => c.qa!.vision!.styleMatch) },
  };
});
const summary: RunSummary = {
  runId, createdAt: status.startedAt, settingsVersion: settings.version, child: { name: "DEMO (synthetic)", gender: "boy" }, models,
  sheet: { file: "sheet/sheet.png", costUsd: 0.15, featureCard: { hairColor: "dark brown", hairStyle: "short", skinTone: "olive", eyes: "brown", notableFeatures: ["synthetic demo"] } },
  scenes, totals, totalCostUsd: 0.15 + totals.reduce((a, t) => a + t.costUsd, 0), thresholds: settings.qa,
};
await writeFile(join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
await writeFile(join(runDir, "report.html"), renderReport(summary, ""));
console.log(`demo run written to ${runDir}`);
