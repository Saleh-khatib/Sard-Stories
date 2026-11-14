"use client";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const CHOICES: Record<string, string[]> = {
  forceSize: ["off", "1K", "2K", "4K"],
  sheetSize: ["1K", "2K", "4K"],
  personGeneration: ["ALLOW_ALL", "ALLOW_ADULT", "ALLOW_NONE"],
};
const MODEL_KEYS = new Set(["sceneEdit", "characterSheet", "visionJudge", "featureCard"]);

interface Props {
  value: Json;
  onChange: (v: Json) => void;
  path: string[];
  modelSuggestions: string[];
}

export function Field({ value, onChange, path, modelSuggestions }: Props) {
  const key = path[path.length - 1] ?? "";
  const label = key.replace(/([A-Z])/g, " $1").toLowerCase();

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return (
      <fieldset className="space-y-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        {path.length > 1 && <legend className="px-1 text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</legend>}
        {Object.entries(value).map(([k, v]) => (
          <Field key={k} value={v} path={[...path, k]} modelSuggestions={modelSuggestions} onChange={(nv) => onChange({ ...value, [k]: nv })} />
        ))}
      </fieldset>
    );
  }

  const row = (control: React.ReactNode) => (
    <label className="grid grid-cols-[200px_1fr] items-start gap-3 text-sm">
      <span className="pt-1 text-neutral-600 dark:text-neutral-400">{label}</span>
      {control}
    </label>
  );

  if (typeof value === "boolean") {
    return row(<input type="checkbox" className="mt-1.5 size-4 justify-self-start" checked={value} onChange={(e) => onChange(e.target.checked)} />);
  }
  if (typeof value === "number" || (value === null && key === "seed")) {
    return row(
      <input
        type="number"
        step="any"
        className="w-40"
        placeholder={value === null ? "random" : undefined}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? (key === "seed" ? null : 0) : Number(e.target.value))}
      />,
    );
  }
  if (Array.isArray(value)) {
    return row(
      <input
        className="w-full"
        value={value.join(", ")}
        onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
      />,
    );
  }
  if (typeof value === "string") {
    const choices = CHOICES[key];
    if (choices) {
      return row(
        <select className="w-40" value={value} onChange={(e) => onChange(e.target.value)}>
          {choices.map((c) => <option key={c}>{c}</option>)}
        </select>,
      );
    }
    if (path[0] === "prompts" || value.length > 80) {
      return row(<textarea className="min-h-28 w-full font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} />);
    }
    const isModel = MODEL_KEYS.has(key);
    return row(
      <>
        <input className="w-full max-w-md" list={isModel ? "model-ids" : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
        {isModel && (
          <datalist id="model-ids">{modelSuggestions.map((m) => <option key={m} value={m} />)}</datalist>
        )}
      </>,
    );
  }
  return null;
}
