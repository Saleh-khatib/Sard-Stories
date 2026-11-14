"use client";

import { Eye, Maximize2, X, ZoomIn } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button, cn } from "./ui";

interface Props {
  src: string;
  label?: string;
  compareSrc?: string;
  onClose: () => void;
}

/** Full-screen viewer: fit, 100% and up to 400% zoom, drag to pan, Ctrl/Cmd + wheel to zoom. Optional original to flip against. */
export function ZoomViewer({ src, label, compareSrc, onClose }: Props) {
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [showOriginal, setShowOriginal] = useState(false);
  const [natural, setNatural] = useState<[number, number] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key.toLowerCase() === "o" && compareSrc) setShowOriginal((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, compareSrc]);

  const current = showOriginal && compareSrc ? compareSrc : src;
  const style: React.CSSProperties =
    zoom === "fit" || !natural
      ? { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }
      : { width: natural[0] * zoom, maxWidth: "none", height: "auto", imageRendering: zoom >= 2 ? "pixelated" : "auto" };

  return (
    <motion.div role="dialog" aria-modal="true" aria-label={label ?? "Image viewer"} className="fixed inset-0 z-50 flex flex-col bg-black/90 text-white" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
        <span className="mr-1 max-w-[50vw] truncate font-semibold">{label}</span>
        {natural && <span className="text-xs text-white/60">{natural[0]}×{natural[1]} px</span>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant={zoom === "fit" ? "primary" : "secondary"} icon={Maximize2} onClick={() => setZoom("fit")} className={zoom === "fit" ? "" : "!bg-white/10 !text-white !border-white/20"}>Fit</Button>
          {([1, 2, 4] as const).map((z) => (
            <Button key={z} size="sm" variant={zoom === z ? "primary" : "secondary"} icon={z === 1 ? ZoomIn : undefined} onClick={() => setZoom(z)} className={zoom === z ? "" : "!bg-white/10 !text-white !border-white/20"}>{z * 100}%</Button>
          ))}
          {compareSrc && (
            <Button size="sm" variant={showOriginal ? "primary" : "secondary"} icon={Eye} onClick={() => setShowOriginal((v) => !v)} className={showOriginal ? "" : "!bg-white/10 !text-white !border-white/20"}>{showOriginal ? "Original (O)" : "Show original (O)"}</Button>
          )}
          <Button size="sm" variant="secondary" icon={X} onClick={onClose} aria-label="Close viewer" className="!bg-white/10 !text-white !border-white/20">Close</Button>
        </div>
      </div>
      <div
        ref={box}
        className={cn("flex-1 overflow-auto", zoom === "fit" ? "flex items-center justify-center p-4" : "cursor-grab active:cursor-grabbing")}
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          setZoom((z) => Math.min(8, Math.max(0.25, (z === "fit" ? 1 : z) * (e.deltaY < 0 ? 1.15 : 0.87))));
        }}
        onPointerDown={(e) => {
          if (!box.current || zoom === "fit") return;
          drag.current = { x: e.clientX, y: e.clientY, sl: box.current.scrollLeft, st: box.current.scrollTop };
          box.current.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current || !box.current) return;
          box.current.scrollLeft = drag.current.sl - (e.clientX - drag.current.x);
          box.current.scrollTop = drag.current.st - (e.clientY - drag.current.y);
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <motion.img key={current} initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} src={current} alt={label ?? ""} style={style} draggable={false} onLoad={(e) => setNatural([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} />
      </div>
      <div className="px-4 py-2 text-center text-xs text-white/50">Drag to pan · Ctrl/⌘ + wheel to zoom · Esc to close</div>
    </motion.div>
  );
}
