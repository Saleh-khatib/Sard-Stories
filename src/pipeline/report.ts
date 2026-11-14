import type { CandidateReport, ModelTotals, RunSummary, SceneReport } from "./runM1";

export const esc = (s: unknown) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const num = (v: number | null | undefined, d = 2) => (v == null || Number.isNaN(v) ? "n/a" : v.toFixed(d));
export const usd = (v: number) => `$${v.toFixed(3)}`;
export const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export const CSS = `
:root{color-scheme:light dark;--bg:#fff7ed;--fg:#2a1a10;--mut:#6b5444;--line:#f1d9bf;--card:#ffffff;--soft:#fff0de;--ok:#15803d;--bad:#dc2626;--accent:#2563eb;--brand:#f97316}
@media (prefers-color-scheme:dark){:root{--bg:#17110c;--fg:#f8ebdd;--mut:#c2a892;--line:#3b2b20;--card:#211812;--soft:#2c2018;--ok:#4ade80;--bad:#f87171;--accent:#60a5fa;--brand:#fb923c}}
body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:15px/1.55 Nunito,system-ui,sans-serif}
h1,h2,h3{font-family:Fredoka,Nunito,system-ui,sans-serif;font-weight:600;letter-spacing:-.01em}
h1{margin:0 0 4px;font-size:32px}h2{margin:32px 0 8px;font-size:24px}h3{margin:16px 0 8px;font-size:18px}
.mut{color:var(--mut)}table{border-collapse:collapse}td,th{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left}
th{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.row{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:12px;width:340px;box-shadow:0 1px 2px rgb(70 35 10/.06),0 10px 28px -14px rgb(70 35 10/.22)}
.card img.z{width:100%;display:block;cursor:zoom-in;border-radius:12px}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:800;font-size:12px}
.pass{background:var(--ok);color:#fff}.fail{background:var(--bad);color:#fff}
@media (prefers-color-scheme:dark){.pass,.fail{color:#17110c}}
.cmp{position:relative;cursor:ew-resize;border-radius:12px;overflow:hidden}.cmp img{width:100%;display:block}
.cmp .top{position:absolute;inset:0;clip-path:inset(0 calc(100% - var(--p,50%)) 0 0)}
.cmp .bar{position:absolute;top:0;bottom:0;left:var(--p,50%);width:3px;background:#fff;box-shadow:0 0 4px #0008}
.cmp .tag{position:absolute;top:8px;font-size:11px;font-weight:700;background:#000a;color:#fff;padding:2px 8px;border-radius:999px}
#lb{position:fixed;inset:0;background:#000d;overflow:auto;display:none;z-index:9;cursor:zoom-out}
#lb img{display:block;margin:0 auto;max-width:none}
.zbtn{background:none;border:0;padding:0;color:var(--accent);text-decoration:underline;cursor:zoom-in;font:inherit;font-weight:600}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.bad{color:var(--bad)}.ok{color:var(--ok)}
`;

export const JS = `
const lb=document.getElementById('lb'),lbi=lb.querySelector('img');
document.addEventListener('click',e=>{const t=e.target;
 if(t.matches('img.z,.zbtn')){lbi.src=t.dataset.full||t.src;lb.style.display='block';lb.scrollTop=0}
 else if(lb.contains(t)){lb.style.display='none'}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')lb.style.display='none'});
for(const c of document.querySelectorAll('.cmp')){
 const set=x=>{const r=c.getBoundingClientRect();c.style.setProperty('--p',Math.max(0,Math.min(100,(x-r.left)/r.width*100))+'%')};
 let d=false;c.addEventListener('pointerdown',e=>{d=true;c.setPointerCapture(e.pointerId);set(e.clientX)});
 c.addEventListener('pointermove',e=>{if(d)set(e.clientX)});c.addEventListener('pointerup',()=>d=false)}
`;

function totalsTable(totals: ModelTotals[]): string {
  const rows = totals
    .map(
      (t) => `<tr><td>${esc(t.model)}</td><td>${t.passed}/${t.candidates}</td><td>${t.rejected}</td><td>${t.errors}</td>
<td>${num(t.avg.edgeSsim)}</td><td>${num(t.avg.seamDelta, 1)}</td><td>${num(t.avg.sharpnessRatio)}</td>
<td>${num(t.avg.likeness, 1)}</td><td>${num(t.avg.styleMatch, 1)}</td><td>${num(t.avg.visionOverall, 1)}</td>
<td>${usd(t.costUsd)}</td><td>${secs(t.avgInstanceMs)}</td></tr>`,
    )
    .join("");
  return `<table><tr><th>Model</th><th>Passed</th><th>Rejected</th><th>Errors</th><th>Edge SSIM</th><th>Seam Δ</th><th>Sharpness</th><th>Likeness</th><th>Style</th><th>Vision</th><th>Cost</th><th>Avg time / instance</th></tr>${rows}</table>`;
}

function candidateCard(c: CandidateReport, s: SceneReport, base: string): string {
  const head = `<b>#${c.n}</b> <span class="badge ${c.verdict.pass ? "pass" : "fail"}">${c.verdict.pass ? "PASS" : "FAIL"}</span> <span class="mut">${usd(c.costUsd)} · ${secs(c.genMs)}</span>`;
  if (!c.files.composite || !c.files.compositeCrop) {
    return `<div class="card">${head}<p class="bad">${esc(c.status)}: ${esc(c.reason ?? "")}</p>${
      c.files.raw ? `<img class="z" src="${base}${esc(c.files.raw)}" loading="lazy">` : ""
    }<div class="mut">${c.attempts.map((a) => `${a.size}→${a.width}×${a.height}`).join(", ")}</div></div>`;
  }
  const q = c.qa!;
  const v = q.vision;
  return `<div class="card">${head}
<div class="cmp"><img src="${base}${esc(c.files.compositeCrop)}"><div class="top"><img src="${base}${esc(s.files.crop)}"></div><div class="bar"></div><span class="tag" style="left:6px">original</span><span class="tag" style="right:6px">edited</span></div>
<div class="mut">drag to compare · <button class="zbtn" data-full="${base}${esc(c.files.compositeCrop)}">zoom crop</button> · <button class="zbtn" data-full="${base}${esc(c.files.composite)}">zoom full page</button> · <button class="zbtn" data-full="${base}${esc(c.files.raw ?? "")}">raw model output</button></div>
<table>
<tr><td>Outside mask identical</td><td class="${q.outsideIdentical ? "ok" : "bad"}">${q.outsideIdentical ? "yes" : `NO (${q.outsideDiffBytes} bytes)`}</td></tr>
<tr><td>Edge SSIM</td><td>${num(q.edgeSsim)}</td></tr>
<tr><td>Seam Δ (original art ${num(q.seamDeltaBaseline, 1)})</td><td>${num(q.seamDelta, 1)}</td></tr>
<tr><td>Sharpness (orig ${num(q.sharpnessBaseline)})</td><td>${num(q.sharpnessRatio)}</td></tr>
${v ? `<tr><td>Likeness / features / style</td><td>${v.likeness} / ${v.featureMatch} / ${v.styleMatch}</td></tr><tr><td>Vision overall</td><td>${v.overall}${v.extraFaces ? " · extra faces" : ""}</td></tr>` : `<tr><td>Vision</td><td class="bad">${esc(q.visionError ?? "n/a")}</td></tr>`}
<tr><td>Output</td><td>${c.outputSize?.join("×")} (${esc(c.requestedSize ?? "")}), crop ${s.box.width}×${s.box.height}</td></tr>
</table>
${c.verdict.reasons.length ? `<div class="bad">${c.verdict.reasons.map(esc).join("<br>")}</div>` : ""}
${v ? `<div class="mut">${esc(v.reason)}</div>` : ""}
</div>`;
}

function sceneSection(s: SceneReport, models: string[], base: string): string {
  const img = (f: string, label: string) =>
    `<div class="card"><b>${label}</b><img class="z" src="${base}${esc(f)}" loading="lazy"><div class="mut">${s.sceneSize.join("×")}</div></div>`;
  const perModel = models
    .map((m) => {
      const cs = s.candidates.filter((c) => c.model === m);
      return `<h3>${esc(m)} <span class="mut">${secs(s.instanceMs[m] ?? 0)} for ${cs.length} candidates</span></h3><div class="row">${cs.map((c) => candidateCard(c, s, base)).join("")}</div>`;
    })
    .join("");
  return `<section><h2>${esc(s.scene)} <span class="mut">crop ${s.box.width}×${s.box.height} (${s.box.ratio})</span></h2>
<div class="row">${img(s.files.original, "Original")}${img(s.files.mask, "Mask")}${img(s.files.outlined, "Crop sent to model")}</div>${perModel}</section>`;
}

export function renderReport(r: RunSummary, base: string): string {
  const fc = r.sheet.featureCard;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M1 report ${esc(r.runId)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600&family=Nunito:wght@400;600;800&display=swap" rel="stylesheet"><style>${CSS}</style></head><body>
<h1>M1 proof of concept</h1>
<div class="mut">Run ${esc(r.runId)} · ${esc(r.createdAt)} · settings v${r.settingsVersion} · child ${esc(r.child.name)} (${esc(r.child.gender)}) · total cost ${usd(r.totalCostUsd)}</div>
<h2>Totals per model</h2>${totalsTable(r.totals)}
<div class="mut">Thresholds: edge SSIM ≥ ${r.thresholds.edgeSsimMin}, seam Δ ≤ ${r.thresholds.seamDeltaMax}, sharpness ≥ ${r.thresholds.sharpnessRelMin}× the original, vision ≥ ${r.thresholds.visionScoreMin}. Sheet cost ${usd(r.sheet.costUsd)}.</div>
<h2>Character sheet</h2><div class="row"><div class="card" style="width:520px"><img class="z" src="${base}${esc(r.sheet.file)}"></div>
<table><tr><td>Hair colour</td><td>${esc(fc.hairColor)}</td></tr><tr><td>Hair style</td><td>${esc(fc.hairStyle)}</td></tr><tr><td>Skin tone</td><td>${esc(fc.skinTone)}</td></tr><tr><td>Eyes</td><td>${esc(fc.eyes)}</td></tr><tr><td>Features</td><td>${esc(fc.notableFeatures.join(", "))}</td></tr></table></div>
${r.scenes.map((s) => sceneSection(s, r.models, base)).join("")}
<div id="lb"><img alt=""></div><script>${JS}</script></body></html>`;
}
