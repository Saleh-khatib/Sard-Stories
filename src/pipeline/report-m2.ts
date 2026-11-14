import { relative } from "node:path";
import type { OrderSummary } from "../orders/summary";
import { CSS, JS, esc, num, usd } from "./report";

/** Self-contained report for one order. `dir` is the folder the report sits in; image paths are made relative to it. */
export function renderM2Report(s: OrderSummary, dir: string, files: { original: string; final: string; sheets: Record<string, string> }): string {
  const rel = (p: string | null) => (p ? esc(relative(dir, p)) : "");
  const status = s.order.status;
  const cards = s.instances
    .map((inst) => {
      const chosen = inst.renders.find((r) => r.id === inst.selectedId);
      const rounds = Math.max(0, ...inst.renders.map((r) => r.version));
      const rows = inst.renders
        .map((r) => {
          const q = r.qa;
          const ocr = q?.ocr ? `${q.ocr.reads.map((x) => esc(x.error ? "error" : `"${x.text}"`)).join(" / ")} ${q.ocr.exact ? '<b class="ok">exact</b>' : '<b class="bad">no match</b>'}` : "";
          return `<tr class="${r.selected ? "sel" : ""}"><td>v${r.version}·${r.candidate}</td><td><span class="badge ${r.status === "ok" ? "pass" : "fail"}">${r.selected ? "CHOSEN" : esc(r.status)}</span></td>
<td>${q ? `${num(q.edgeSsim)} / ${num(q.seamDelta, 1)} / ${num(q.sharpnessBaseline > 0 ? q.sharpnessRatio / q.sharpnessBaseline : 1)}×` : ""}</td><td>${q?.vision ? q.vision.overall : ""}</td><td>${ocr}</td><td>${esc(r.outputSize ?? "")}</td><td>${usd(r.costUsd)}</td><td class="bad">${esc(r.qaReason ?? "")}</td>
<td>${r.compositePath ? `<img class="z" style="height:48px;border-radius:6px" src="${rel(r.compositePath)}" data-full="${rel(r.compositePath)}" loading="lazy">` : ""}</td></tr>`;
        })
        .join("");
      const flagged = s.results.flatMap((x) => x.flaggedInstances).find((f) => f.instanceId === inst.id);
      return `<div class="card" style="width:auto;flex:1 1 100%">
<h3>${esc(inst.id)} <span class="mut">${esc(inst.kind)} · ${esc(inst.ageStage)} · ${esc(inst.view)}</span> <span class="badge ${chosen ? "pass" : "fail"}">${chosen ? "PASSED" : "FLAGGED"}</span></h3>
<div class="mut">${rounds} round(s), ${inst.renders.length} candidates, ${usd(inst.costUsd)}${inst.expected ? ` · expected text <b>"${esc(inst.expected)}"</b> (was "${esc(inst.originalWords ?? "")}")` : ""}</div>
${flagged ? `<div class="bad">Flagged for the operator: ${esc(flagged.reason)}</div>` : ""}
<table style="margin-top:8px;font-size:13px"><tr><th>Try</th><th>Result</th><th>Edge / seam / sharpness vs original</th><th>Judge</th><th>OCR read-back</th><th>Size</th><th>Cost</th><th>Reason</th><th>Crop</th></tr>${rows}</table></div>`;
    })
    .join("");
  const result = s.results[0];
  const sheetCards = Object.entries(files.sheets).map(([stage, p]) => `<div class="card"><b>${esc(stage)} sheet</b><img class="z" src="${esc(relative(dir, p))}" loading="lazy"></div>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M2 order ${esc(s.order.id)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600&family=Nunito:wght@400;600;800&display=swap" rel="stylesheet"><style>${CSS}.sel{background:var(--soft)}</style></head><body>
<h1>M2 core pipeline</h1>
<div class="mut">Order ${esc(s.order.id)} · settings v${s.order.settingsVersion} · child ${esc(s.child.name)} (${esc(s.child.gender)}) · status <b>${esc(status)}</b> · total cost ${usd(s.totals.costUsd)} (sheets ${usd(s.totals.sheetCostUsd)}) · ${s.totals.renders} renders recorded</div>
<h2>Result</h2>
<div class="mut">Pixels outside the edited masks identical to the original: <b class="${result?.outsideUnionIdentical ? "ok" : "bad"}">${result?.outsideUnionIdentical ? "yes" : "NO"}</b></div>
<div class="row"><div class="card" style="width:min(1100px,100%)"><div class="cmp"><img src="${rel(files.final)}"><div class="top"><img src="${rel(files.original)}"></div><div class="bar"></div><span class="tag" style="left:8px">original</span><span class="tag" style="right:8px">personalised</span></div>
<div class="mut">drag to compare · <button class="zbtn" data-full="${rel(files.final)}">zoom result</button> · <button class="zbtn" data-full="${rel(files.original)}">zoom original</button></div></div></div>
<h2>Instances</h2><div class="row">${cards}</div>
<h2>Character sheets</h2><div class="row">${sheetCards}</div>
<div id="lb"><img alt=""></div><script>${JS}</script></body></html>`;
}
