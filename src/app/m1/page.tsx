"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Minus, Play, Plus, XCircle } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Check, PageHeader, cn, rise, stagger } from "@/components/ui";

const SCENES = ["front", "side", "back"] as const;
type Inputs = {
  scenes: Record<string, { scene: boolean; mask: boolean; sceneSize: number[] | null; maskSize: number[] | null; sizesMatch: boolean }>;
  child: { photo: boolean; info: boolean; name: string | null; gender: string | null };
  ready: boolean;
  problems: string[];
};
type Settings = {
  generation: { candidates: number };
  models: { compare: string[]; prices: Record<string, { inputPerM: number; outputImagePerM: number; outputTextPerM: number }> };
};
type Run = { runId: string; state: string; done: number; total: number; startedAt: string; current: string };

function Row({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-soft px-4 py-3">
      {ok ? <CheckCircle2 className="size-5 shrink-0 text-ok" aria-hidden /> : <XCircle className="size-5 shrink-0 text-bad" aria-hidden />}
      <span className="font-semibold">{label}</span>
      <span className="ml-auto text-sm text-mute">{detail}</span>
    </li>
  );
}

export default function M1Page() {
  const router = useRouter();
  const [inputs, setInputs] = useState<Inputs | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [scenes, setScenes] = useState<string[]>([...SCENES]);
  const [models, setModels] = useState<string[]>([]);
  const [candidates, setCandidates] = useState(3);
  const [error, setError] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    void (async () => {
      const s = (await fetch("/api/settings").then((r) => r.json())).settings as Settings;
      setSettings(s);
      setModels(s.models.compare);
      setCandidates(s.generation.candidates);
      setInputs(await fetch("/api/m1/inputs").then((r) => r.json()));
      setRuns((await fetch("/api/m1/runs").then((r) => r.json())).runs);
    })();
  }, []);

  const imageModels = useMemo(() => (settings ? Object.keys(settings.models.prices).filter((m) => m.includes("image")) : []), [settings]);
  const estimate = useMemo(() => {
    if (!settings) return 0;
    const per = models.reduce((sum, m) => {
      const p = settings.models.prices[m];
      return sum + (p ? (1500 * p.inputPerM + 1120 * p.outputImagePerM) / 1e6 : 0);
    }, 0);
    return per * scenes.length * candidates * 1.25;
  }, [settings, models, scenes, candidates]);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const start = async () => {
    setStarting(true);
    setError([]);
    const res = await fetch("/api/m1/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenes, models, candidates }) });
    const body = await res.json();
    if (res.ok) router.push(`/m1/runs/${body.runId}`);
    else { setError(body.error); setStarting(false); }
  };

  if (!inputs || !settings) {
    return <div className="flex items-center gap-2 text-mute"><Loader2 className="size-4 animate-spin" aria-hidden /> Loading…</div>;
  }
  const selectedReady = scenes.every((s) => inputs.scenes[s]?.scene && inputs.scenes[s]?.mask && inputs.scenes[s]?.sizesMatch) && inputs.child.photo && inputs.child.info;
  const edits = scenes.length * models.length * candidates;

  return (
    <>
      <PageHeader title="Proof of concept" subtitle="Swap the hero for a real child on three scenes, compare models, and check that nothing outside the mask changes." />
      <motion.div variants={stagger} initial="hidden" animate="show" className="grid gap-5 lg:grid-cols-2">
        <Card variants={rise}>
          <h2 className="mb-1 text-xl font-semibold">1 · Your files</h2>
          <p className="mb-4 text-sm text-mute">Read from the <code className="rounded bg-soft px-1">test-data</code> folder on this computer.</p>
          <ul className="space-y-2">
            {SCENES.map((s) => {
              const r = inputs.scenes[s];
              const ok = !!r && r.scene && r.mask && r.sizesMatch;
              return <Row key={s} ok={ok} label={`${s[0]?.toUpperCase()}${s.slice(1)} scene + mask`} detail={r?.sceneSize ? `${r.sceneSize.join("×")}${r.sizesMatch ? "" : " · mask differs"}` : "missing"} />;
            })}
            <Row ok={inputs.child.photo && inputs.child.info} label="Child photo + info" detail={inputs.child.name ? `${inputs.child.name}, ${inputs.child.gender}` : "missing"} />
          </ul>
          {inputs.problems.length > 0 && (
            <div className="mt-4 flex gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
              <ul className="space-y-1">{inputs.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
        </Card>

        <Card variants={rise}>
          <h2 className="mb-4 text-xl font-semibold">2 · Run the experiment</h2>
          <div className="space-y-5">
            <fieldset>
              <legend className="mb-2 text-sm font-bold text-mute">Scenes</legend>
              <div className="flex flex-wrap gap-2">{SCENES.map((s) => <Check key={s} label={s} checked={scenes.includes(s)} onChange={() => toggle(scenes, setScenes, s)} />)}</div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-bold text-mute">Models to compare</legend>
              <div className="flex flex-wrap gap-2">{imageModels.map((m) => <Check key={m} label={m} checked={models.includes(m)} onChange={() => toggle(models, setModels, m)} />)}</div>
            </fieldset>
            <div>
              <div className="mb-2 text-sm font-bold text-mute">Versions per scene</div>
              <div className="inline-flex items-center gap-1 rounded-full bg-soft p-1">
                <Button variant="ghost" size="sm" aria-label="Fewer versions" onClick={() => setCandidates((c) => Math.max(1, c - 1))} icon={Minus} className="size-9 !px-0" />
                <span className="w-8 text-center text-lg font-bold" aria-live="polite">{candidates}</span>
                <Button variant="ghost" size="sm" aria-label="More versions" onClick={() => setCandidates((c) => Math.min(4, c + 1))} icon={Plus} className="size-9 !px-0" />
              </div>
            </div>
            <div className="rounded-2xl bg-soft p-4">
              <div className="text-sm text-mute">{scenes.length} scene(s) × {models.length} model(s) × {candidates} version(s)</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-display text-3xl font-semibold">{edits} edits</span>
                <span className="text-mute">about ${estimate.toFixed(2)}</span>
              </div>
              <p className="mt-1 text-xs text-mute">Estimate from your price table; the character sheet and judge calls add a little.</p>
            </div>
            <Button size="lg" icon={Play} loading={starting} onClick={start} disabled={!selectedReady || !scenes.length || !models.length} className="w-full">Run experiment</Button>
            {!selectedReady && <p className="text-sm text-mute">Add the missing files on the left first.</p>}
            {error.length > 0 && <ul className="list-disc pl-5 text-sm text-bad">{error.map((e) => <li key={e}>{e}</li>)}</ul>}
          </div>
        </Card>

        <Card variants={rise} className="lg:col-span-2">
          <h2 className="mb-4 text-xl font-semibold">3 · Previous runs</h2>
          {runs.length === 0 ? <p className="text-mute">No runs yet. Your first one will show up here.</p> : (
            <ul className="grid gap-2 md:grid-cols-2">
              {runs.map((r) => (
                <li key={r.runId}>
                  <Link href={`/m1/runs/${r.runId}`} className={cn("flex items-center gap-3 rounded-2xl bg-soft px-4 py-3 transition-colors hover:bg-brand/15")}>
                    <span className="truncate font-semibold">{r.runId}</span>
                    <span className="ml-auto flex items-center gap-2">
                      <Badge tone={r.state === "done" ? "ok" : r.state === "error" ? "bad" : "info"} icon={r.state === "done" ? CheckCircle2 : r.state === "error" ? XCircle : Loader2}>{r.state}</Badge>
                      <span className="text-sm text-mute">{r.done}/{r.total}</span>
                      <ArrowRight className="size-4 text-mute" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </motion.div>
    </>
  );
}
