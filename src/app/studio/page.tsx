"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Bookmark, CheckCircle2, Download, ImagePlus, Loader2, RefreshCw, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ZoomViewer } from "@/components/ZoomViewer";
import { Badge, Button, Card, PageHeader, ProgressBar, Segmented, cn, fieldCls, rise, stagger } from "@/components/ui";
import { SUPPORTED_RATIOS } from "@/pipeline/ratios";
import type { StudioOptions } from "@/pipeline/studio";
import type { BatchRec, JobRec, Preset, VersionRec } from "@/server/studio";

type Settings = { enhance: { model: string; size: string; candidates: number }; models: { prices: Record<string, { inputPerM: number; outputImagePerM: number }> } };
type Picked = { id: string; file: File; url: string };
type Scene = (typeof SCENES)[number];

const SCENES = ["front", "side", "back"] as const;
const SIZES = ["1K", "2K", "4K"] as const;
const TOKENS: Record<string, number> = { "1K": 1120, "2K": 1120, "4K": 2000 };
const fileUrl = (f: string) => `/api/files/out/studio/${f}`;
const LS_KEY = "studio-options-v1";
const select = cn(fieldCls, "rounded-full pr-8");

const defaults = (s: Settings): StudioOptions => ({ mode: "enhance", model: s.enhance.model, ratio: "auto", size: s.enhance.size as StudioOptions["size"], versions: Math.max(1, s.enhance.candidates), prompt: "", improvePrompt: false });
const safeName = (n: string) => n.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_");

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
  const [scene, setScene] = useState<Scene>("front");
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [presetId, setPresetId] = useState("");
  const [over, setOver] = useState(false);
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

  if (!settings || !opts) return <div className="flex items-center gap-2 text-mute"><Loader2 className="size-4 animate-spin" aria-hidden /> Loading…</div>;
  const set = (patch: Partial<StudioOptions>) => setOpts({ ...opts, ...patch });

  const addFiles = (list: FileList | File[]) => {
    const add = Array.from(list).filter((f) => f.type.startsWith("image/")).map((f) => ({ id: crypto.randomUUID(), file: f, url: URL.createObjectURL(f) }));
    setPicked((p) => [...p, ...add].slice(0, 30));
  };
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

  const post = async (b: BatchRec, body: object) => {
    const res = await fetch(`/api/studio/batch/${b.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) setCurrent((await res.json()).batch);
  };
  const apply = async (b: BatchRec, job: JobRec, n: number) => {
    const v = job.versions.find((x) => x.n === n);
    if (!window.confirm(`Replace the "${scene}" scene with this ${v?.width}×${v?.height} image?\n\nThe current scene and its mask are backed up first, and the mask is rescaled to the new size.`)) return;
    const res = await fetch("/api/studio/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: b.id, jobId: job.id, n, scene }) });
    const body = await res.json();
    setApplyMsg(res.ok ? `Done: ${scene} is now ${body.size.join("×")}. ${body.notes.join("; ")}.` : `Not applied: ${body.error}`);
  };
  const download = (job: JobRec) => {
    const v = job.versions.find((x) => x.n === job.selected);
    if (!v?.file) return;
    const a = document.createElement("a");
    a.href = fileUrl(v.file);
    a.download = `${safeName(job.name)}-${v.width}x${v.height}.png`;
    a.click();
  };
  const downloadAll = async (b: BatchRec) => {
    for (const job of b.jobs) { download(job); await new Promise((r) => setTimeout(r, 400)); }
  };

  return (
    <>
      <PageHeader title="Image studio" subtitle="Enhance or edit many images at once, or generate from a prompt. Make up to four versions of each and keep the best." />

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented id="studio-mode" value={opts.mode} onChange={(m) => set({ mode: m })} options={[{ value: "enhance", label: "Enhance / edit images", icon: Wand2 }, { value: "generate", label: "Generate", icon: Sparkles }]} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select className={select} value={presetId} onChange={(e) => loadPreset(e.target.value)} aria-label="Presets">
              <option value="">Presets…</option>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Button variant="secondary" size="sm" icon={Bookmark} onClick={savePreset}>Save preset</Button>
            {presetId && <Button variant="ghost" size="sm" icon={Trash2} onClick={deletePreset} aria-label="Delete preset">Delete</Button>}
          </div>
        </div>

        <div
          className={cn("flex min-h-28 flex-wrap items-center gap-3 rounded-2xl border-2 border-dashed p-3 transition-colors", over ? "border-accent bg-accent/10" : "border-line bg-soft/60")}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
        >
          <AnimatePresence mode="popLayout">
            {picked.map((p) => (
              <motion.div key={p.id} layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={{ type: "spring", stiffness: 420, damping: 30 }} className="relative">
                <img src={p.url} alt={p.file.name} className="size-20 rounded-xl object-cover shadow-card" />
                <button onClick={() => setPicked((x) => x.filter((y) => y.id !== p.id))} className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-ink text-canvas" aria-label={`Remove ${p.file.name}`}><X className="size-3.5" aria-hidden /></button>
              </motion.div>
            ))}
          </AnimatePresence>
          <Button variant="secondary" icon={ImagePlus} onClick={() => input.current?.click()} className="h-20 rounded-xl px-5">{opts.mode === "enhance" ? "Add images" : "Image refs"}</Button>
          <input ref={input} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          {picked.length === 0 && <span className="text-sm text-mute">{opts.mode === "enhance" ? "Drop several images here. Each one is enhanced separately." : "Optional: drop reference images to guide the generation."}</span>}
        </div>

        <textarea className={cn(fieldCls, "min-h-28 w-full resize-y py-3")} aria-label="Prompt" placeholder={opts.mode === "enhance" ? "Optional: extra instructions, for example “keep the paper texture”" : "Describe your image…"} value={opts.prompt} onChange={(e) => set({ prompt: e.target.value })} />

        <div className="flex flex-wrap items-center gap-2">
          <select className={select} value={opts.model} onChange={(e) => set({ model: e.target.value })} aria-label="Model">{imageModels.map((m) => <option key={m}>{m}</option>)}</select>
          <select className={select} value={opts.ratio} onChange={(e) => set({ ratio: e.target.value })} aria-label="Aspect ratio"><option value="auto">Auto ratio</option>{SUPPORTED_RATIOS.map((r) => <option key={r.label}>{r.label}</option>)}</select>
          <select className={select} value={opts.size} onChange={(e) => set({ size: e.target.value as StudioOptions["size"] })} aria-label="Output size">{SIZES.map((s) => <option key={s}>{s}</option>)}</select>
          <select className={select} value={opts.versions} onChange={(e) => set({ versions: Number(e.target.value) })} aria-label="Versions per image">{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} version{n > 1 ? "s" : ""}</option>)}</select>
          {opts.mode === "generate" && (
            <button type="button" role="switch" aria-checked={opts.improvePrompt} onClick={() => set({ improvePrompt: !opts.improvePrompt })} className={cn("inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors", opts.improvePrompt ? "border-transparent bg-accent text-on-accent" : "border-line bg-surface hover:bg-soft")}>
              <Sparkles className="size-4" aria-hidden /> Improve prompt
            </button>
          )}
          <span className="ml-auto text-sm text-mute">{jobCount} job{jobCount === 1 ? "" : "s"} × {opts.versions} · about ${estimate.toFixed(2)}</span>
          <Button size="lg" icon={Sparkles} loading={busy} disabled={!canRun} onClick={run}>Generate</Button>
        </div>
        {error && <p className="text-sm font-semibold text-bad">{error}</p>}
      </Card>

      <AnimatePresence mode="wait">
        {current && (
          <motion.div key={current.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <BatchView b={current} scene={scene} setScene={setScene} onChoose={(j, n) => post(current, { jobId: j.id, n })} onRetry={(j) => post(current, { jobId: j.id, retry: true })} apply={apply} download={download} downloadAll={downloadAll} onZoom={setZoom} applyMsg={applyMsg} />
          </motion.div>
        )}
      </AnimatePresence>

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-semibold">History</h2>
        {batches.length === 0 ? <p className="text-mute">Nothing yet.</p> : (
          <motion.ul variants={stagger} initial="hidden" animate="show" className="grid gap-2 md:grid-cols-2">
            {batches.map((b) => (
              <motion.li key={b.id} variants={rise}>
                <button className="flex w-full items-center gap-3 rounded-2xl bg-soft px-4 py-3 text-left transition-colors hover:bg-brand/15" onClick={() => { setCurrent(b); setApplyMsg(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                  <span className="font-semibold">{new Date(b.createdAt).toLocaleString()}</span>
                  <span className="ml-auto text-sm text-mute">{b.options.mode} · {b.jobs.length} job(s) · {b.options.size} · ${b.totalCostUsd.toFixed(2)}</span>
                </button>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </section>

      <AnimatePresence>{zoom && <ZoomViewer src={zoom.src} label={zoom.label} compareSrc={zoom.compare} onClose={() => setZoom(null)} />}</AnimatePresence>
    </>
  );
}

function BatchView({ b, scene, setScene, onChoose, onRetry, apply, download, downloadAll, onZoom, applyMsg }: {
  b: BatchRec; scene: Scene; setScene: (s: Scene) => void;
  onChoose: (j: JobRec, n: number | null) => void; onRetry: (j: JobRec) => void; apply: (b: BatchRec, j: JobRec, n: number) => void;
  download: (j: JobRec) => void; downloadAll: (b: BatchRec) => void; onZoom: (z: { src: string; label: string; compare?: string }) => void; applyMsg: string | null;
}) {
  const total = b.jobs.length * b.options.versions;
  const done = b.jobs.reduce((a, j) => a + j.versions.length, 0);
  const chosen = b.jobs.filter((j) => j.selected !== null).length;
  return (
    <section className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">{b.options.mode === "enhance" ? "Enhance" : "Generate"} · {new Date(b.createdAt).toLocaleTimeString()}</h2>
        <Badge tone={b.state === "running" ? "info" : "ok"} icon={b.state === "running" ? Loader2 : CheckCircle2}>{b.state === "running" ? `${done}/${total} versions` : "done"}</Badge>
        <span className="text-sm text-mute">${b.totalCostUsd.toFixed(2)}</span>
        {b.state === "running" && <ProgressBar className="w-40" value={total ? (done / total) * 100 : 0} />}
        <Button variant="secondary" size="sm" icon={Download} disabled={chosen === 0} onClick={() => downloadAll(b)} className="ml-auto">Download all chosen ({chosen})</Button>
      </div>

      {b.jobs.map((job) => {
        const failed = job.state !== "running" && job.state !== "queued" && Array.from({ length: b.options.versions }, (_, i) => i + 1).some((n) => !job.versions.find((x) => x.n === n)?.file);
        return (
          <Card key={job.id} className="space-y-3 !p-4">
            <div className="flex flex-wrap items-center gap-2">
              <b className="max-w-[40ch] truncate">{job.name}</b>
              <Badge tone={job.state === "done" ? "ok" : job.state === "error" ? "bad" : "info"}>{job.state}</Badge>
              {job.refSizes[0] && <span className="text-sm text-mute">input {job.refSizes[0].join("×")}</span>}
              {job.selected !== null && (
                <span className="ml-auto flex flex-wrap items-center gap-2">
                  <Button size="sm" icon={Download} onClick={() => download(job)}>Download chosen</Button>
                  <select className={cn(select, "!h-9")} value={scene} onChange={(e) => setScene(e.target.value as Scene)} aria-label="Scene to replace">{SCENES.map((s) => <option key={s}>{s}</option>)}</select>
                  <Button size="sm" variant="secondary" onClick={() => apply(b, job, job.selected as number)}>Use as scene</Button>
                </span>
              )}
            </div>
            {job.error && <p className="text-sm font-semibold text-bad">{job.error}</p>}
            {failed && <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => onRetry(job)}>Retry the versions that failed</Button>}
            <motion.div variants={stagger} initial="hidden" animate="show" className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Array.from({ length: b.options.versions }, (_, i) => i + 1).map((n) => {
                const v = job.versions.find((x) => x.n === n);
                return <VersionTile key={n} n={n} v={v} pending={job.state === "running" || job.state === "queued"} selected={job.selected === n} onChoose={() => onChoose(job, job.selected === n ? null : n)} onZoom={() => v?.file && onZoom({ src: fileUrl(v.file), label: `${job.name} · version ${n}`, compare: b.options.mode === "enhance" && job.refs[0] ? fileUrl(job.refs[0]) : undefined })} />;
              })}
            </motion.div>
            {job.finalPrompt && b.options.mode === "generate" && <details className="text-sm text-mute"><summary className="cursor-pointer font-semibold">Prompt used</summary><p className="mt-1 whitespace-pre-wrap">{job.finalPrompt}</p></details>}
          </Card>
        );
      })}
      {applyMsg && <p className="text-sm font-semibold">{applyMsg}</p>}
      <p className="text-sm text-mute">Enhancing regenerates the picture, so fine details can shift slightly. Check faces, text and edges at 100% before using a version as the new original.</p>
    </section>
  );
}

function VersionTile({ n, v, pending, selected, onChoose, onZoom }: { n: number; v?: VersionRec; pending: boolean; selected: boolean; onChoose: () => void; onZoom: () => void }) {
  return (
    <motion.div variants={rise} layout className={cn("space-y-1.5 rounded-2xl p-1.5 transition-shadow", selected ? "ring-2 ring-accent" : "ring-1 ring-line")}>
      <div className="relative aspect-square overflow-hidden rounded-xl bg-soft">
        {v?.file ? (
          <button className="size-full cursor-zoom-in" onClick={onZoom} aria-label={`Inspect version ${n}`}>
            <img src={fileUrl(v.file)} alt={`Version ${n}`} className="size-full object-contain" />
          </button>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-sm text-mute">
            {v?.error ? <><AlertTriangle className="size-5 text-bad" aria-hidden /><span className="text-bad">{/429|RESOURCE_EXHAUSTED/.test(v.error) ? "Google rate limit hit. Use “Retry”." : v.error.slice(0, 100)}</span></> : pending ? <><Loader2 className="size-5 animate-spin" aria-hidden />Generating…</> : "No image"}
          </div>
        )}
      </div>
      {v?.file && (
        <div className="space-y-1 px-1 pb-1 text-xs">
          <div className="flex items-center justify-between gap-1">
            <span className="font-semibold">#{n} · {v.width}×{v.height}</span>
            <button onClick={onChoose} aria-pressed={selected} className={cn("inline-flex h-8 items-center gap-1 rounded-full px-3 font-bold transition-colors", selected ? "bg-accent text-on-accent" : "border border-line hover:bg-soft")}>
              {selected && <CheckCircle2 className="size-3.5" aria-hidden />}{selected ? "Chosen" : "Choose"}
            </button>
          </div>
          <div className="text-mute">${v.costUsd.toFixed(3)} · {(v.ms / 1000).toFixed(0)}s{v.structureMatch !== null ? ` · match ${v.structureMatch.toFixed(2)}` : ""}{v.sharpnessGain ? ` · sharp ×${v.sharpnessGain.toFixed(1)}` : ""}</div>
          {v.warnings.map((w) => <div key={w} className="flex gap-1 text-warn"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />{w}</div>)}
        </div>
      )}
    </motion.div>
  );
}
