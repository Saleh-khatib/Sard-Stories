"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  src: string;
  label?: string;
  compareSrc?: string;
  onClose: () => void;
}

/** Full-screen viewer: fit, 100% and up to 400% zoom, drag to pan, wheel to zoom. Optional original to flip against. */
export function ZoomViewer({ src, label, compareSrc, onClose }: Props) {
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [showOriginal, setShowOriginal] = useState(false);
  const [natural, setNatural] = useState<[number, number] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "o" && compareSrc) setShowOriginal((v) => !v);
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
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 text-white">
      <div className="flex items-center gap-2 px-4 py-2 text-sm">
        <span className="mr-2 truncate">{label}</span>
        {natural && <span className="text-xs text-white/60">{natural[0]}×{natural[1]} px</span>}
        <div className="ml-auto flex items-center gap-1">
          {(["fit", 1, 2, 4] as const).map((z) => (
            <button key={z} onClick={() => setZoom(z)} className={`rounded px-2 py-1 ${zoom === z ? "bg-white text-black" : "bg-white/15"}`}>
              {z === "fit" ? "Fit" : `${z * 100}%`}
            </button>
          ))}
          {compareSrc && (
            <button onClick={() => setShowOriginal((v) => !v)} className={`ml-2 rounded px-2 py-1 ${showOriginal ? "bg-amber-400 text-black" : "bg-white/15"}`}>
              {showOriginal ? "Showing original (O)" : "Show original (O)"}
            </button>
          )}
          <button onClick={onClose} className="ml-2 rounded bg-white/15 px-2 py-1">Close (Esc)</button>
        </div>
      </div>
      <div
        ref={box}
        className={`flex-1 overflow-auto ${zoom === "fit" ? "flex items-center justify-center" : "cursor-grab"}`}
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
        <img src={current} alt={label ?? ""} style={style} draggable={false} onLoad={(e) => setNatural([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} />
      </div>
      <div className="px-4 py-1 text-center text-xs text-white/50">Drag to pan · Ctrl/⌘ + wheel to zoom</div>
    </div>
  );
}
