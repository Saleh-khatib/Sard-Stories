"use client";

import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Loader2, PlugZap, RotateCcw, Save, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Field } from "@/components/SettingsEditor";
import { Badge, Button, Card, PageHeader, Segmented } from "@/components/ui";

type Settings = Record<string, unknown> & { models: { prices: Record<string, unknown> }; version: number };
const TABS = ["connection", "models", "generation", "enhance", "masking", "qa", "queue", "prompts"] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = { connection: "Connection", models: "Models", generation: "Generation", enhance: "Enhance", masking: "Masking", qa: "Quality checks", queue: "Queue", prompts: "Prompts" };
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

  if (!settings || !defaults) return <div className="flex items-center gap-2 text-mute"><Loader2 className="size-4 animate-spin" aria-hidden /> Loading…</div>;

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

  return (
    <>
      <PageHeader title="Settings" subtitle={`Every model, prompt, threshold and price lives here. Version ${settings.version}, saved in the database.`} />
      <Segmented id="settings-tabs" value={tab} onChange={(t) => setTab(t)} options={TABS.map((t) => ({ value: t, label: LABEL[t] }))} className="mb-5 max-w-full" />

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="space-y-5">
          {tab === "connection" && conn && (
            <Card className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl bg-soft p-4"><div className="text-xs font-bold text-mute">Project</div><div className="font-semibold">{conn.project || "not set"}</div></div>
                <div className="rounded-2xl bg-soft p-4"><div className="text-xs font-bold text-mute">Location</div><div className="font-semibold">{conn.location}</div></div>
                <div className="rounded-2xl bg-soft p-4"><div className="text-xs font-bold text-mute">Credentials</div><div className="font-semibold">{conn.credentials}</div></div>
              </div>
              <p className="text-sm text-mute">Keys are never typed or shown here. Locally the server uses your <code className="rounded bg-soft px-1">gcloud auth application-default login</code>; on a server, set GOOGLE_APPLICATION_CREDENTIALS in its environment. Empty fields below fall back to .env.</p>
              <Button variant="secondary" icon={PlugZap} loading={check === "running"} onClick={runCheck}>Test connection (one tiny request per model)</Button>
              {Array.isArray(check) && (
                <ul className="space-y-2">
                  {check.map((r) => (
                    <li key={r.model + r.kind} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-soft px-4 py-3 text-sm">
                      <span className="font-semibold">{r.model}</span>
                      <span className="text-mute">{r.kind}</span>
                      <Badge tone={r.ok ? "ok" : "bad"} icon={r.ok ? CheckCircle2 : XCircle}>{r.ok ? "available" : "failed"}</Badge>
                      <span className="text-mute">{r.detail}</span>
                      <span className="ml-auto text-mute">{(r.ms / 1000).toFixed(1)}s · ${r.costUsd.toFixed(3)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          <Card>
            <Field value={settings[tab] as never} path={[tab]} modelSuggestions={Object.keys(settings.models.prices)} onChange={(v) => { setSettings({ ...settings, [tab]: v }); setDirty(true); setMsg(null); }} />
          </Card>
        </motion.div>
      </AnimatePresence>

      <div className="sticky bottom-20 z-30 mt-5 md:bottom-4">
        <AnimatePresence>
          {(dirty || msg) && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ type: "spring", stiffness: 380, damping: 32 }} className="flex flex-wrap items-center gap-3 rounded-full border border-line bg-surface px-4 py-3 shadow-pop">
              <Button icon={Save} onClick={save} disabled={!dirty}>Save</Button>
              <Button variant="ghost" icon={RotateCcw} onClick={() => { setSettings({ ...settings, [tab]: defaults[tab] }); setDirty(true); }}>Reset {LABEL[tab].toLowerCase()}</Button>
              <Button variant="ghost" onClick={() => void load()}>Discard</Button>
              {dirty && <span className="text-sm font-semibold text-warn">Unsaved changes</span>}
              {msg && <span className={msg.ok ? "text-sm font-semibold text-ok" : "text-sm font-semibold text-bad"}>{msg.text.join(" · ")}</span>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
