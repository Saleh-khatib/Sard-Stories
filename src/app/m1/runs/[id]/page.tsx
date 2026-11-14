"use client";

import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Badge, Card, PageHeader, ProgressBar } from "@/components/ui";

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

  const back = <Link href="/m1" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-mute hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> Experiment</Link>;
  if (missing) return <>{back}<p>Run not found.</p></>;
  if (!status) return <div className="flex items-center gap-2 text-mute"><Loader2 className="size-4 animate-spin" aria-hidden /> Loading…</div>;
  const pct = status.total ? (status.done / status.total) * 100 : 0;
  const reportUrl = `/api/files/out/m1/${id}/report.html`;

  return (
    <>
      {back}
      <PageHeader
        title={`Run ${id.slice(0, 19).replace("T", " ")}`}
        actions={<Badge tone={status.state === "done" ? "ok" : status.state === "error" ? "bad" : "info"} icon={status.state === "done" ? CheckCircle2 : status.state === "error" ? XCircle : Loader2}>{status.state}</Badge>}
      />
      {status.state === "running" && (
        <Card className="mb-5 space-y-3">
          <ProgressBar value={pct} />
          <p className="text-sm text-mute">{status.done} of {status.total} versions · {status.current}</p>
        </Card>
      )}
      {status.state === "error" && <Card className="mb-5 border-bad/40 bg-bad/10"><pre className="whitespace-pre-wrap text-sm text-bad">{status.error}</pre></Card>}
      {status.state === "done" && (
        <Card className="overflow-hidden !p-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <span className="font-semibold">Report</span>
            <a className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline" href={reportUrl} target="_blank" rel="noreferrer">Open in a new tab <ExternalLink className="size-4" aria-hidden /></a>
          </div>
          <iframe src={reportUrl} title="M1 report" className="h-[80vh] w-full bg-white" />
        </Card>
      )}
    </>
  );
}
