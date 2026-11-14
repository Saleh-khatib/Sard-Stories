"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ZoomViewer } from "@/components/ZoomViewer";
import { SUPPORTED_RATIOS } from "@/pipeline/ratios";
import type { BatchRec, JobRec, Preset, VersionRec } from "@/server/studio";
import type { StudioOptions } from "@/pipeline/studio";

type Settings = { enhance: { model: string; size: string; candidates: number }; models: { prices: Record<string, { inputPerM: number; outputImagePerM: number }> } };
type Picked = { id: string; file: File; url: string };

const SCENES = ["front", "side", "back"] as const;
const SIZES = ["1K", "2K", "4K"] as const;
const TOKENS: Record<string, number> = { "1K": 1120, "2K": 1120, "4K": 2000 };
const fileUrl = (f: string) => `/api/files/out/studio/${f}`;
const LS_KEY = "studio-options-v1";

const defaults = (s: Settings): StudioOptions => ({ mode: "enhance", model: s.enhance.model, ratio: "auto", size: s.enhance.size as StudioOptions["size"], versions: Math.max(1, s.enhance.candidates), prompt: "", improvePrompt: false });

export default function StudioPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [opts, setOpts] = useState<StudioOptions | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [batches, setBatches] = useState<BatchRec[]>([]);
  const [current, setCurrent] = useState<BatchRec | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ src: string; label: string; compare?: string } | null>(null);
  const [scene, setScene] = useState<(typeof SCENES)[number]>("front");
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [presetId, setPresetId] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const refreshLists = useCallback(async () => {
    const [p, b] = await Promise.all([fetch("/api/studio/presets").then((r) => r.json()), fetch("/api/studio/batch").then((r) => r.json())]);
    setPresets(p.presets);
    setBatches(b.batches);
  }, []);

  useEffect(() => {
    void (async () => {
      const s = (await fetch("/api/settings").then((r) => r.json())).settings as Settings;
      setSettings(s);
      let o = defaults(s);
      try { const saved = localStorage.getItem(LS_KEY); if (saved) o = { ...o, ...JSON.parse(saved) }; } catch { /* storage unavailable */ }
      setOpts(o);
      await refreshLists();
    })();
  }, [refreshLists]);

  useEffect(() => {
    if (!opts) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(opts)); } catch { /* storage unavailable */ }
  }, [opts]);

  useEffect(() => {
    if (!current || current.state !== "running") return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/studio/batch/${current.id}`);
      if (r.ok) {
        const b = (await r.json()).batch as BatchRec;
        setCurrent(b);
        if (b.state !== "running") void refreshLists();
      }
    }, 1500);
    return () => clearInterval(t);
  }, [current, refreshLists]);

  const imageModels = useMemo(() => (settings ? Object.keys(settings.models.prices).filter((m) => m.includes("image")) : []), [settings]);
  const jobCount = opts?.mode === "enhance" ? picked.length : 1;
  const estimate = useMemo(() => {
    const p = settings && opts ? settings.models.prices[opts.model] : undefined;
    if (!p || !opts) return 0;
    return jobCount * opts.versions * ((1500 * p.inputPerM + (TOKENS[opts.size] ?? 2000) * p.outputImagePerM) / 1e6);
  }, [settings, opts, jobCount]);

  if (!settings || !opts) return <p className="text-sm text-neutral-500">Loading…</p>;
  const set = (patch: Partial<StudioOptions>) => setOpts({ ...opts, ...patch });

  const addFiles = (list: FileList | File[]) => {
    const add = Array.from(list).filter((f) => f.type.startsWith("image/")).map((f) => ({ id: crypto.randomUUID(), file: f, url: URL.createObjectURL(f) }));
    setPicked((p) => [...p, ...add].slice(0, 30));
  };
  const removePicked = (id: string) => setPicked((p) => p.filter((x) => x.id !== id));

  const canRun = !busy && (opts.mode === "enhance" ? picked.length > 0 : opts.prompt.trim().length > 0);

  const run = async () => {
    setBusy(true); setError(null); setApplyMsg(null);
    const form = new FormData();
    form.set("options", JSON.stringify(opts));
    for (const p of picked) form.append("files", p.file);
    const res = await fetch("/api/studio/batch", { method: "POST", body: form });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Failed");
    setCurrent(body.batch);
    void refreshLists();
  };

  const savePreset = async () => {
    const name = window.prompt("Preset name", presets.find((p) => p.id === presetId)?.name ?? "");
    if (!name) return;
    const res = await fetch("/api/studio/presets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, options: opts }) });
    const body = await res.json();
    if (res.ok) { setPresets(body.presets); setPresetId(body.saved.id); } else setError(body.error);
  };
  const loadPreset = (id: string) => {
    setPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (p) setOpts({ ...p.options });
  };
  const deletePreset = async () => {
    if (!presetId || !window.confirm("Delete this preset?")) return;
    const res = await fetch(`/api/studio/presets?id=${presetId}`, { method: "DELETE" });
    setPresets((await res.json()).presets);
    setPresetId("");
  };

  const choose = async (b: BatchRec, job: JobRec, n: number | null) => {
    const res = await fetch(`/api/studio/batch/${b.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id, n }) });
    if (res.ok) setCurrent((await res.json()).batch);
  };
  const retry = async (b: BatchRec, job: JobRec) => {
    const res = await fetch(`/api/studio/batch/${b.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id, retry: true }) });
    if (res.ok) setCurrent((await res.json()).batch);
  };
  const apply = async (b: BatchRec, job: JobRec, n: number) => {
    const v = job.versions.find((x) => x.n === n);
    if (!window.confirm(`Replace the "${scene}" scene with this ${v?.width}×${v?.height} image?\n\nThe current scene and its mask are backed up first, and the mask is rescaled to the new size.`)) return;
    const res = await fetch("/api/studio/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: b.id, jobId: job.id, n, scene }) });
    const body = await res.json();
    setApplyMsg(res.ok ? `Done: ${scene} is now ${body.size.join("×")}. ${body.notes.join("; ")}.` : `Not applied: ${body.error}`);
  };
  const downloadAll = async (b: BatchRec) => {
    for (const job of b.jobs) {
      const v = job.versions.find((x) => x.n === job.selected);
      if (!v?.file) continue;
      const a = document.createElement("a");
      a.href = fileUrl(v.file);
      a.download = `${job.name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_")}-${v.width}x${v.height}.png`;
      a.click();
      await new Promise((r) => setTimeout(r, 400));
    }
  };

  const modeBtn = (m: StudioOptions["mode"], label: string) => (
    <button onClick={() => set({ mode: m })} className={`rounded-md px-3 py-1.5 text-sm ${opts.mode === m ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}>{label}</button>
  );
  const chip = "rounded-full border border-neutral-300 bg-transparent px-3 py-1 text-sm dark:border-neutral-700";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Image studio</h1>
        <p className="text-sm text-neutral-500">Enhance or edit many images at once, or generate from a prompt. Make up to 4 versions of each and keep the best.</p>
      </div>

      <section className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">{modeBtn("enhance", "Enhance / edit images")}{modeBtn("generate", "Generate")}</div>
          <span className="ml-auto flex items-center gap-2 text-sm">
            <select className={chip} value={presetId} onChange={(e) => loadPreset(e.target.value)}>
              <option value="">Presets…</option>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className={chip} onClick={savePreset}>Save preset</button>
            {presetId && <button className={chip} onClick={deletePreset}>Delete</button>}
          </span>
        </div>

        <div
          className="flex min-h-24 flex-wrap items-center gap-2 rounded-xl border border-dashed border-neutral-300 p-2 dark:border-neutral-700"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        >
          {picked.map((p) => (
            <div key={p.id} className="relative">
              <img src={p.url} alt={p.file.name} className="h-20 w-20 rounded-lg object-cover" />
              <button onClick={() => removePicked(p.id)} className="absolute -right-1 -top-1 size-5 rounded-full bg-black/70 text-xs text-white" aria-label={`Remove ${p.file.name}`}>×</button>
            </div>
          ))}
          <button onClick={() => input.current?.click()} className="flex h-20 w-24 flex-col items-center justify-center rounded-lg bg-neutral-100 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            + {opts.mode === "enhance" ? "Add images" : "Image refs"}
          </button>
          <input ref={input} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          {picked.length === 0 && <span className="text-xs text-neutral-500">{opts.mode === "enhance" ? "Drop several images here. Each one is enhanced separately." : "Optional: drop reference images to guide the generation."}</span>}
        </div>

        <textarea
          className="min-h-24 w-full resize-y p-3 text-sm"
          placeholder={opts.mode === "enhance" ? "Optional: extra instructions, for example “keep the paper texture”" : "Describe your image…"}
          value={opts.prompt}
          onChange={(e) => set({ prompt: e.target.value })}
        />

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select className={chip} value={opts.model} onChange={(e) => set({ model: e.target.value })} title="Model">{imageModels.map((m) => <option key={m}>{m}</option>)}</select>
          <select className={chip} value={opts.ratio} onChange={(e) => set({ ratio: e.target.value })} title="Aspect ratio">
            <option value="auto">Auto ratio</option>{SUPPORTED_RATIOS.map((r) => <option key={r.label}>{r.label}</option>)}
          </select>
          <select className={chip} value={opts.size} onChange={(e) => set({ size: e.target.value as StudioOptions["size"] })} title="Output size">{SIZES.map((s) => <option key={s}>{s}</option>)}</select>
          <select className={chip} value={opts.versions} onChange={(e) => set({ versions: Number(e.target.value) })} title="Versions per image">
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} version{n > 1 ? "s" : ""}</option>)}
          </select>
          {opts.mode === "generate" && (
            <label className={`${chip} flex items-center gap-1`}><input type="checkbox" checked={opts.improvePrompt} onChange={(e) => set({ improvePrompt: e.target.checked })} /> Improve prompt</label>
          )}
          <span className="ml-auto text-xs text-neutral-500">{jobCount} job{jobCount === 1 ? "" : "s"} × {opts.versions} · about ${estimate.toFixed(2)}</span>
          <button onClick={run} disabled={!canRun} className="rounded-full bg-neutral-900 px-5 py-2 text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900">{busy ? "Starting…" : "Generate"}</button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>

      {current && <BatchView b={current} scene={scene} setScene={setScene} choose={choose} retry={retry} apply={apply} downloadAll={downloadAll} onZoom={setZoom} applyMsg={applyMsg} />}

      <section className="space-y-2">
        <h2 className="font-medium">History</h2>
        {batches.length === 0 ? <p className="text-sm text-neutral-500">Nothing yet.</p> : (
          <ul className="space-y-1 text-sm">
            {batches.map((b) => (
              <li key={b.id}>
                <button className="underline" onClick={() => { setCurrent(b); setApplyMsg(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{new Date(b.createdAt).toLocaleString()}</button>{" "}
                <span className="text-neutral-500">{b.options.mode} · {b.jobs.length} job(s) · {b.options.model} {b.options.size} · ${b.totalCostUsd.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {zoom && <ZoomViewer src={zoom.src} label={zoom.label} compareSrc={zoom.compare} onClose={() => setZoom(null)} />}
    </div>
  );
}

function BatchView({ b, scene, setScene, choose, retry, apply, downloadAll, onZoom, applyMsg }: {
  b: BatchRec; scene: (typeof SCENES)[number]; setScene: (s: (typeof SCENES)[number]) => void;
  choose: (b: BatchRec, j: JobRec, n: number | null) => void; retry: (b: BatchRec, j: JobRec) => void; apply: (b: BatchRec, j: JobRec, n: number) => void;
  downloadAll: (b: BatchRec) => void; onZoom: (z: { src: string; label: string; compare?: string }) => void; applyMsg: string | null;
}) {
  const total = b.jobs.length * b.options.versions;
  const done = b.jobs.reduce((a, j) => a + j.versions.length, 0);
  const chosen = b.jobs.filter((j) => j.selected !== null).length;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-medium">{b.options.mode === "enhance" ? "Enhance" : "Generate"} · {new Date(b.createdAt).toLocaleTimeString()}</h2>
        <span className="text-sm text-neutral-500">{b.state === "running" ? `Working… ${done}/${total} versions` : `Done · ${done}/${total} versions`} · ${b.totalCostUsd.toFixed(2)}</span>
        {b.state === "running" && <div className="h-1.5 w-40 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-blue-600 transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>}
        <button onClick={() => downloadAll(b)} disabled={chosen === 0} className="ml-auto rounded-md border border-neutral-300 px-3 py-1 text-sm disabled:opacity-40 dark:border-neutral-700">Download all chosen ({chosen})</button>
      </div>
      {b.jobs.map((job) => (
        <div key={job.id} className="space-y-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <b className="truncate">{job.name}</b>
            <span className="text-neutral-500">{job.state}{job.refSizes[0] ? ` · input ${job.refSizes[0].join("×")}` : ""}</span>
            {job.selected !== null && (
              <span className="ml-auto flex items-center gap-1">
                <button className="rounded-md bg-neutral-900 px-3 py-1 text-white dark:bg-neutral-100 dark:text-neutral-900" onClick={() => { const v = job.versions.find((x) => x.n === job.selected); if (v?.file) { const a = document.createElement("a"); a.href = fileUrl(v.file); a.download = `${job.name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_")}-${v.width}x${v.height}.png`; a.click(); } }}>Download chosen</button>
                <select className="rounded-md border border-neutral-300 px-1 py-1 dark:border-neutral-700" value={scene} onChange={(e) => setScene(e.target.value as (typeof SCENES)[number])}>{SCENES.map((s) => <option key={s}>{s}</option>)}</select>
                <button className="rounded-md border border-neutral-300 px-3 py-1 dark:border-neutral-700" onClick={() => apply(b, job, job.selected as number)}>Use as scene</button>
              </span>
            )}
          </div>
          {job.error && <p className="text-sm text-red-600">{job.error}</p>}
          {job.state !== "running" && job.state !== "queued" && Array.from({ length: b.options.versions }, (_, i) => i + 1).some((n) => !job.versions.find((x) => x.n === n)?.file) && (
            <button onClick={() => retry(b, job)} className="rounded-md border border-amber-600 px-3 py-1 text-sm text-amber-700 dark:text-amber-400">Retry the versions that failed</button>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: b.options.versions }, (_, i) => i + 1).map((n) => {
              const v = job.versions.find((x) => x.n === n);
              return <VersionTile key={n} n={n} v={v} pending={job.state === "running" || job.state === "queued"} selected={job.selected === n} job={job}
                onChoose={() => choose(b, job, job.selected === n ? null : n)}
                onZoom={() => v?.file && onZoom({ src: fileUrl(v.file), label: `${job.name} · version ${n}`, compare: b.options.mode === "enhance" && job.refs[0] ? fileUrl(job.refs[0]) : undefined })} />;
            })}
          </div>
          {job.finalPrompt && b.options.mode === "generate" && <details className="text-xs text-neutral-500"><summary className="cursor-pointer">Prompt used</summary><p className="mt-1 whitespace-pre-wrap">{job.finalPrompt}</p></details>}
        </div>
      ))}
      {applyMsg && <p className="text-sm">{applyMsg}</p>}
      <p className="text-xs text-neutral-500">Enhancing regenerates the picture, so fine details can shift slightly. Check faces, text and edges at 100% before using a version as the new original.</p>
    </section>
  );
}

function VersionTile({ n, v, pending, selected, onChoose, onZoom }: { n: number; v?: VersionRec; pending: boolean; selected: boolean; job: JobRec; onChoose: () => void; onZoom: () => void }) {
  return (
    <div className={`space-y-1 rounded-lg p-1.5 text-xs ${selected ? "ring-2 ring-blue-600" : "ring-1 ring-neutral-200 dark:ring-neutral-800"}`}>
      <div className="aspect-square overflow-hidden rounded bg-neutral-100 dark:bg-neutral-900">
        {v?.file ? <img src={fileUrl(v.file)} alt={`version ${n}`} className="size-full cursor-zoom-in object-contain" onClick={onZoom} />
          : <div className="flex size-full items-center justify-center p-2 text-center text-neutral-500">{v?.error ? <span className="text-red-600">{/429|RESOURCE_EXHAUSTED/.test(v.error) ? "Google rate limit hit. Use “Retry the versions that failed”." : v.error.slice(0, 120)}</span> : pending ? "Generating…" : "No image"}</div>}
      </div>
      {v?.file && (
        <>
          <div className="flex items-center justify-between">
            <span>#{n} · {v.width}×{v.height}</span>
            <button onClick={onChoose} className={`rounded-full px-2 py-0.5 ${selected ? "bg-blue-600 text-white" : "border border-neutral-300 dark:border-neutral-700"}`}>{selected ? "Chosen" : "Choose"}</button>
          </div>
          <div className="text-neutral-500">${v.costUsd.toFixed(3)} · {(v.ms / 1000).toFixed(0)}s{v.structureMatch !== null ? ` · match ${v.structureMatch.toFixed(2)}` : ""}{v.sharpnessGain ? ` · sharp ×${v.sharpnessGain.toFixed(1)}` : ""}</div>
          {v.warnings.map((w) => <div key={w} className="text-amber-700 dark:text-amber-400">⚠ {w}</div>)}
        </>
      )}
    </div>
  );
}
