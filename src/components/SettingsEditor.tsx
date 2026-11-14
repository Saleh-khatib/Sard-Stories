"use client";

import { cn, fieldCls } from "./ui";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const CHOICES: Record<string, string[]> = {
  forceSize: ["off", "1K", "2K", "4K"],
  sheetSize: ["1K", "2K", "4K"],
  size: ["1K", "2K", "4K"],
  personGeneration: ["ALLOW_ALL", "ALLOW_ADULT", "ALLOW_NONE"],
};
const MODEL_KEYS = new Set(["sceneEdit", "characterSheet", "visionJudge", "featureCard", "model"]);

interface Props {
  value: Json;
  onChange: (v: Json) => void;
  path: string[];
  modelSuggestions: string[];
}

const words = (k: string) => k.replace(/([A-Z])/g, " $1").toLowerCase();

export function Field({ value, onChange, path, modelSuggestions }: Props) {
  const key = path[path.length - 1] ?? "";

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return (
      <fieldset className={cn("space-y-4", path.length > 1 && "rounded-2xl bg-soft/70 p-4")}>
        {path.length > 1 && <legend className="px-1 text-xs font-extrabold uppercase tracking-wide text-mute">{words(key)}</legend>}
        {Object.entries(value).map(([k, v]) => (
          <Field key={k} value={v} path={[...path, k]} modelSuggestions={modelSuggestions} onChange={(nv) => onChange({ ...value, [k]: nv })} />
        ))}
      </fieldset>
    );
  }

  const row = (control: React.ReactNode, wide = false) => (
    <label className={cn("grid items-start gap-2 text-sm", wide ? "" : "md:grid-cols-[210px_1fr] md:gap-4")}>
      <span className="pt-2 font-semibold capitalize text-mute">{words(key)}</span>
      {control}
    </label>
  );

  if (typeof value === "boolean") {
    return row(<input type="checkbox" className="mt-2 size-5 justify-self-start accent-[var(--accent)]" checked={value} onChange={(e) => onChange(e.target.checked)} />);
  }
  if (typeof value === "number" || (value === null && key === "seed")) {
    return row(
      <input type="number" step="any" className={cn(fieldCls, "w-44")} placeholder={value === null ? "random" : undefined} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? (key === "seed" ? null : 0) : Number(e.target.value))} />,
    );
  }
  if (Array.isArray(value)) {
    return row(<input className={cn(fieldCls, "w-full")} value={value.join(", ")} onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />);
  }
  if (typeof value === "string") {
    const choices = CHOICES[key];
    if (choices) {
      return row(<select className={cn(fieldCls, "w-44")} value={value} onChange={(e) => onChange(e.target.value)}>{choices.map((c) => <option key={c}>{c}</option>)}</select>);
    }
    if (path[0] === "prompts" || value.length > 80) {
      return row(<textarea className={cn(fieldCls, "min-h-32 w-full resize-y py-2 font-mono text-xs leading-relaxed")} value={value} onChange={(e) => onChange(e.target.value)} />);
    }
    const isModel = MODEL_KEYS.has(key);
    return row(
      <>
        <input className={cn(fieldCls, "w-full max-w-md")} list={isModel ? "model-ids" : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
        {isModel && <datalist id="model-ids">{modelSuggestions.map((m) => <option key={m} value={m} />)}</datalist>}
      </>,
    );
  }
  return null;
}
