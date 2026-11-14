import "dotenv/config";
import { loadSettings } from "../src/settings/load";
import { SCENE_NAMES, inspectInputs, type SceneName } from "../src/pipeline/inputs";
import { runM1 } from "../src/pipeline/runM1";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const settings = await loadSettings();
const inputs = await inspectInputs();
if (!inputs.ready) {
  console.error("Inputs are not ready:\n- " + inputs.problems.join("\n- "));
  process.exit(1);
}
const scenes = (arg("scenes")?.split(",") ?? [...SCENE_NAMES]) as SceneName[];
const models = arg("models")?.split(",") ?? settings.models.compare;
if (arg("candidates")) settings.generation.candidates = Number(arg("candidates"));
const runId = arg("run-id") ?? new Date().toISOString().replace(/[:.]/g, "-");

console.log(`run ${runId}: scenes=${scenes.join(",")} models=${models.join(",")} candidates=${settings.generation.candidates}`);
const summary = await runM1({
  runId, scenes, models, settings, photoFile: arg("photo"),
  onStatus: (s) => console.log(`[${s.done}/${s.total}] ${s.current}`),
});
for (const t of summary.totals) console.log(`${t.model}: ${t.passed}/${t.candidates} passed, $${t.costUsd.toFixed(3)}, ${(t.avgInstanceMs / 1000).toFixed(1)}s/instance`);
console.log(`report: out/m1/${runId}/report.html (latest: out/m1/report.html)`);
