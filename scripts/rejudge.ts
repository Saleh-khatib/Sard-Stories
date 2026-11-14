import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderReport } from "../src/pipeline/report";
import { judgeVerdict, type CandidateReport, type RunSummary } from "../src/pipeline/runM1";
import { loadSettings } from "../src/settings/load";

// Re-applies the current QA thresholds to a finished run's saved numbers (no API calls) and rewrites its report.
const runId = process.argv[2];
if (!runId) throw new Error("usage: tsx scripts/rejudge.ts <run-id>");
const settings = await loadSettings();
const dir = join("out/m1", runId);
const summary = JSON.parse(await readFile(join(dir, "summary.json"), "utf8")) as RunSummary;
summary.thresholds = settings.qa;
for (const sc of summary.scenes) {
  for (const c of sc.candidates as CandidateReport[]) {
    if (c.qa) c.verdict = judgeVerdict(c.qa, settings.qa);
    await writeFile(join(dir, sc.scene, c.model, String(c.n), "report.json"), JSON.stringify(c, null, 2));
  }
}
for (const t of summary.totals) t.passed = summary.scenes.flatMap((s) => s.candidates).filter((c) => c.model === t.model && c.verdict.pass).length;
await writeFile(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
await writeFile(join(dir, "report.html"), renderReport(summary, ""));
await writeFile("out/m1/report.html", renderReport(summary, `${runId}/`));
console.log(summary.totals.map((t) => `${t.model}: ${t.passed}/${t.candidates} pass`).join(" · "));
