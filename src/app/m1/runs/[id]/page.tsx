"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

type Status = { runId: string; state: "running" | "done" | "error"; total: number; done: number; current: string; error: string | null };

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [status, setStatus] = useState<Status | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const res = await fetch(`/api/m1/runs/${id}`);
      if (res.status === 404) return setMissing(true);
      const body = await res.json();
      if (stop) return;
      setStatus(body.status);
      if (body.status.state === "running") setTimeout(tick, 2000);
    };
    void tick();
    return () => { stop = true; };
  }, [id]);

  if (missing) return <p className="text-sm">Run not found. <Link className="underline" href="/m1">Back</Link></p>;
  if (!status) return <p className="text-sm text-neutral-500">Loading…</p>;
  const pct = status.total ? Math.round((status.done / status.total) * 100) : 0;
  const reportUrl = `/api/files/out/m1/${id}/report.html`;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <Link className="text-sm underline" href="/m1">← M1</Link>
        <h1 className="text-xl font-semibold">Run {id}</h1>
        <span className="text-sm text-neutral-500">{status.state}</span>
      </div>
      {status.state === "running" && (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800"><div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} /></div>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{status.done}/{status.total} candidates · {status.current}</p>
        </div>
      )}
      {status.state === "error" && <pre className="whitespace-pre-wrap rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{status.error}</pre>}
      {status.state === "done" && (
        <>
          <a className="text-sm underline" href={reportUrl} target="_blank" rel="noreferrer">Open report in a new tab</a>
          <iframe src={reportUrl} title="M1 report" className="h-[85vh] w-full rounded-lg border border-neutral-200 bg-white dark:border-neutral-800" />
        </>
      )}
    </div>
  );
}
