"use client";

import { useCallback, useEffect, useState } from "react";
import { Field } from "@/components/SettingsEditor";

type Settings = Record<string, unknown> & { models: { prices: Record<string, unknown> }; version: number };
const TABS = ["connection", "models", "generation", "masking", "qa", "prompts"] as const;
type Tab = (typeof TABS)[number];
type CheckRow = { model: string; kind: string; ok: boolean; detail: string; ms: number; costUsd: number };

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [defaults, setDefaults] = useState<Settings | null>(null);
  const [tab, setTab] = useState<Tab>("connection");
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string[] } | null>(null);
  const [conn, setConn] = useState<{ project: string; location: string; credentials: string } | null>(null);
  const [check, setCheck] = useState<CheckRow[] | "running" | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/settings").then((x) => x.json());
    setSettings(r.settings);
    setDefaults(r.defaults);
    setDirty(false);
    setConn(await fetch("/api/vertex/status").then((x) => x.json()));
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!settings || !defaults) return <p className="text-sm text-neutral-500">Loading settings…</p>;

  const save = async () => {
    const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
    const body = await res.json();
    if (res.ok) {
      setSettings(body.settings);
      setDirty(false);
      setMsg({ ok: true, text: [`Saved as version ${body.settings.version}`] });
      setConn(await fetch("/api/vertex/status").then((x) => x.json()));
    } else setMsg({ ok: false, text: body.error as string[] });
  };

  const runCheck = async () => {
    setCheck("running");
    const res = await fetch("/api/vertex/check", { method: "POST" });
    const body = await res.json();
    setCheck(body.results ?? [{ model: "connection", kind: "-", ok: false, detail: body.error ?? "failed", ms: 0, costUsd: 0 }]);
  };

  const modelIds = Object.keys(settings.models.prices);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">Settings</h1>
        <span className="text-xs text-neutral-500">version {settings.version} · saved to settings.m1.json</span>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 text-sm capitalize ${tab === t ? "border-b-2 border-neutral-900 font-medium dark:border-neutral-100" : "text-neutral-500"}`}>
            {t === "qa" ? "QA" : t}
          </button>
        ))}
      </div>

      {tab === "connection" && conn && (
        <div className="space-y-3 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
          <p><b>Resolved project:</b> {conn.project || <span className="text-red-600">none</span>} · <b>location:</b> {conn.location}</p>
          <p><b>Credentials:</b> {conn.credentials}</p>
          <p className="text-xs text-neutral-500">
            Keys are never entered or shown here. Locally the server uses your <code>gcloud auth application-default login</code>; on a server, set GOOGLE_APPLICATION_CREDENTIALS in the server environment. Empty fields below fall back to .env.
          </p>
          <button onClick={runCheck} disabled={check === "running"} className="rounded-md bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">
            {check === "running" ? "Testing…" : "Test connection (one tiny request per model)"}
          </button>
          {Array.isArray(check) && (
            <table className="w-full text-xs">
              <tbody>
                {check.map((r) => (
                  <tr key={r.model + r.kind} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="py-1 pr-3">{r.model}</td><td className="pr-3">{r.kind}</td>
                    <td className={`pr-3 ${r.ok ? "text-green-600" : "text-red-600"}`}>{r.ok ? "available" : "failed"}</td>
                    <td className="pr-3">{r.detail}</td><td className="pr-3">{(r.ms / 1000).toFixed(1)}s</td><td>${r.costUsd.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Field
        value={settings[tab] as never}
        path={[tab]}
        modelSuggestions={modelIds}
        onChange={(v) => { setSettings({ ...settings, [tab]: v }); setDirty(true); setMsg(null); }}
      />

      <div className="sticky bottom-0 flex items-center gap-3 border-t border-neutral-200 bg-neutral-50 py-3 dark:border-neutral-800 dark:bg-neutral-950">
        <button onClick={save} disabled={!dirty} className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900">Save</button>
        <button onClick={() => { setSettings({ ...settings, [tab]: defaults[tab] }); setDirty(true); }} className="text-sm underline">Reset {tab} to defaults</button>
        <button onClick={() => void load()} className="text-sm underline">Discard changes</button>
        {dirty && <span className="text-xs text-amber-600">unsaved changes</span>}
        {msg && <span className={`text-xs ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text.join(" · ")}</span>}
      </div>
    </div>
  );
}
