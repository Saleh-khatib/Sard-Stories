import { writeFile } from "node:fs/promises";
import sharp from "sharp";

// One-off: traces the rectilinear Sard logo PNG into a single SVG path (outline loops, no seams, scales cleanly).
const src = process.argv[2] ?? "public/brand/sard-logo-source.png";
const { data, info } = await sharp(src).flatten({ background: "#ffffff" }).greyscale().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && (data[y * W + x] as number) < 128;

let minX = W, minY = H, maxX = -1, maxY = -1;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (on(x, y)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }

// Directed boundary edges with ink on the left-hand side, keyed by start vertex.
type P = [number, number];
const out = new Map<string, P[]>();
const add = (a: P, b: P) => { const k = a.join(","); (out.get(k) ?? out.set(k, []).get(k)!).push(b); };
for (let y = minY; y <= maxY; y++) {
  for (let x = minX; x <= maxX; x++) {
    if (!on(x, y)) continue;
    if (!on(x, y - 1)) add([x, y], [x + 1, y]);
    if (!on(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
    if (!on(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
    if (!on(x - 1, y)) add([x, y + 1], [x, y]);
  }
}
const loops: P[][] = [];
while (out.size) {
  const startKey = out.keys().next().value as string;
  const start = startKey.split(",").map(Number) as P;
  const loop: P[] = [start];
  let cur = start;
  for (;;) {
    const k = cur.join(",");
    const nexts = out.get(k);
    if (!nexts?.length) break;
    const nx = nexts.pop() as P;
    if (!nexts.length) out.delete(k);
    if (nx[0] === start[0] && nx[1] === start[1]) break;
    loop.push(nx);
    cur = nx;
  }
  loops.push(loop);
}
// Snap coordinates that differ by <= 2px (anti-aliasing noise) onto the position carrying the most edge length.
function snapMap(weights: Map<number, number>): Map<number, number> {
  const keys = [...weights.keys()].sort((a, b) => a - b);
  const map = new Map<number, number>();
  let group: number[] = [];
  const flush = () => {
    if (!group.length) return;
    const best = group.reduce((a, b) => ((weights.get(b) ?? 0) > (weights.get(a) ?? 0) ? b : a));
    for (const g of group) map.set(g, best);
    group = [];
  };
  for (const k of keys) {
    if (group.length && k - (group[group.length - 1] as number) > 2) flush();
    group.push(k);
  }
  flush();
  return map;
}
const wx = new Map<number, number>(), wy = new Map<number, number>();
for (const l of loops) {
  for (let i = 0; i < l.length; i++) {
    const a = l[i] as P, b = l[(i + 1) % l.length] as P;
    if (a[0] === b[0]) wx.set(a[0], (wx.get(a[0]) ?? 0) + Math.abs(b[1] - a[1]));
    else wy.set(a[1], (wy.get(a[1]) ?? 0) + Math.abs(b[0] - a[0]));
  }
}
const mx = snapMap(wx), my = snapMap(wy);
const simplify = (l: P[]) => {
  const snapped = l.map((p): P => [mx.get(p[0]) ?? p[0], my.get(p[1]) ?? p[1]]);
  const dedup = snapped.filter((p, i) => { const q = snapped[(i + snapped.length - 1) % snapped.length] as P; return p[0] !== q[0] || p[1] !== q[1]; });
  return dedup.filter((p, i) => {
    const a = dedup[(i + dedup.length - 1) % dedup.length] as P, b = dedup[(i + 1) % dedup.length] as P;
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
  });
};
const ox = minX, oy = minY, w = maxX - minX + 1, h = maxY - minY + 1;
const d = loops.map((l) => "M" + simplify(l).map((p) => `${p[0] - ox} ${p[1] - oy}`).join("L") + "Z").join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" fill="currentColor"><path fill-rule="evenodd" d="${d}"/></svg>\n`;
await writeFile("public/brand/sard-logo.svg", svg);
await writeFile("src/components/sard-logo-path.ts", `export const SARD_LOGO = { width: ${w}, height: ${h}, d: "${d}" } as const;\n`);
console.log(`logo ${w}x${h}, ${loops.length} loops, ${d.length} path chars`);
