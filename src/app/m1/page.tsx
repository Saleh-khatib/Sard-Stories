"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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

const Mark = ({ ok }: { ok: boolean }) => <span className={ok ? "text-green-600" : "text-red-600"}>{ok ? "✓" : "✗"}</span>;

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

  if (!inputs || !settings) return <p className="text-sm text-neutral-500">Loading…</p>;
  const selectedReady = scenes.every((s) => inputs.scenes[s]?.scene && inputs.scenes[s]?.mask && inputs.scenes[s]?.sizesMatch) && inputs.child.photo && inputs.child.info;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">M1 proof of concept</h1>
        <p className="text-sm text-neutral-500">Replace the hero on 3 scenes, compare models, and check that nothing outside the mask changes.</p>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">1. Inputs <span className="text-xs font-normal text-neutral-500">test-data/ (git-ignored)</span></h2>
        <table className="text-sm">
          <thead><tr className="text-left text-xs text-neutral-500"><th className="pr-6">Scene</th><th className="pr-6">Image</th><th className="pr-6">Mask</th><th>Sizes</th></tr></thead>
          <tbody>
            {SCENES.map((s) => {
              const r = inputs.scenes[s];
              return r && (
                <tr key={s}>
                  <td className="pr-6">{s}</td>
                  <td className="pr-6"><Mark ok={r.scene} /> {r.sceneSize?.join("×")}</td>
                  <td className="pr-6"><Mark ok={r.mask} /> {r.maskSize?.join("×")}</td>
                  <td>{r.scene && r.mask ? <><Mark ok={r.sizesMatch} /> {r.sizesMatch ? "match" : "mask and scene differ"}</> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-sm"><Mark ok={inputs.child.photo} /> child/photo.jpg · <Mark ok={inputs.child.info} /> child/info.json {inputs.child.name && <span className="text-neutral-500">({inputs.child.name}, {inputs.child.gender})</span>}</p>
        {inputs.problems.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-400">{inputs.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">2. Experiment</h2>
        <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div><div className="mb-1 text-xs text-neutral-500">Scenes</div>{SCENES.map((s) => (
            <label key={s} className="mr-3"><input type="checkbox" checked={scenes.includes(s)} onChange={() => toggle(scenes, setScenes, s)} /> {s}</label>
          ))}</div>
          <div><div className="mb-1 text-xs text-neutral-500">Models to compare</div>{imageModels.map((m) => (
            <label key={m} className="mr-3"><input type="checkbox" checked={models.includes(m)} onChange={() => toggle(models, setModels, m)} /> {m}</label>
          ))}</div>
          <div><div className="mb-1 text-xs text-neutral-500">Candidates per instance</div>
            <input type="number" min={1} max={4} className="w-20" value={candidates} onChange={(e) => setCandidates(Number(e.target.value))} /></div>
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {scenes.length} scene(s) × {models.length} model(s) × {candidates} candidate(s) = <b>{scenes.length * models.length * candidates}</b> edits ·
          rough cost <b>${estimate.toFixed(2)}</b> <span className="text-xs">(estimate from the price table, plus sheet and judge calls)</span>
        </p>
        <button onClick={start} disabled={!selectedReady || !scenes.length || !models.length || starting} className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900">
          {starting ? "Starting…" : "Run experiment"}
        </button>
        {!selectedReady && <span className="ml-3 text-xs text-neutral-500">Add the missing inputs above first.</span>}
        {error.length > 0 && <ul className="list-disc pl-5 text-sm text-red-600">{error.map((e) => <li key={e}>{e}</li>)}</ul>}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">3. Previous runs</h2>
        {runs.length === 0 ? <p className="text-sm text-neutral-500">No runs yet.</p> : (
          <table className="text-sm">
            <tbody>
              {runs.map((r) => (
                <tr key={r.runId}>
                  <td className="pr-6"><Link className="underline" href={`/m1/runs/${r.runId}`}>{r.runId}</Link></td>
                  <td className="pr-6">{r.state}</td><td>{r.done}/{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
