import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import sharp from "sharp";

export const SCENE_NAMES = ["front", "side", "back"] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

export const ChildInfoSchema = z.object({ name: z.string().min(1), gender: z.enum(["boy", "girl"]) });
export type ChildInfo = z.infer<typeof ChildInfoSchema>;

export interface InputStatus {
  scenes: Record<SceneName, { scene: boolean; mask: boolean; sceneSize: [number, number] | null; maskSize: [number, number] | null; sizesMatch: boolean }>;
  child: { photo: boolean; info: boolean; name: string | null; gender: string | null; infoError: string | null };
  ready: boolean;
  problems: string[];
}

export const paths = (root: string, scene: SceneName) => ({
  scene: join(root, "scenes", `${scene}.png`),
  mask: join(root, "masks", `${scene}.png`),
});
export const photoPath = (root: string) => join(root, "child", "photo.jpg");
export const infoPath = (root: string) => join(root, "child", "info.json");

async function size(path: string): Promise<[number, number] | null> {
  try {
    const m = await sharp(path).metadata();
    return m.width && m.height ? [m.width, m.height] : null;
  } catch {
    return null;
  }
}

export async function inspectInputs(root = "test-data"): Promise<InputStatus> {
  const problems: string[] = [];
  const scenes = {} as InputStatus["scenes"];
  for (const s of SCENE_NAMES) {
    const p = paths(root, s);
    const [hasScene, hasMask] = [existsSync(p.scene), existsSync(p.mask)];
    const [sceneSize, maskSize] = await Promise.all([hasScene ? size(p.scene) : null, hasMask ? size(p.mask) : null]);
    const sizesMatch = !!sceneSize && !!maskSize && sceneSize[0] === maskSize[0] && sceneSize[1] === maskSize[1];
    scenes[s] = { scene: hasScene, mask: hasMask, sceneSize, maskSize, sizesMatch };
    if (!hasScene) problems.push(`Missing ${p.scene}`);
    if (!hasMask) problems.push(`Missing mask ${p.mask} (masks are never guessed)`);
    if (hasScene && hasMask && !sizesMatch) problems.push(`${s}: mask size ${maskSize?.join("x")} does not match scene ${sceneSize?.join("x")}`);
  }
  const photo = existsSync(photoPath(root));
  let info = false, name: string | null = null, gender: string | null = null, infoError: string | null = null;
  if (existsSync(infoPath(root))) {
    try {
      const parsed = ChildInfoSchema.parse(JSON.parse(await readFile(infoPath(root), "utf8")));
      info = true; name = parsed.name; gender = parsed.gender;
    } catch (e) {
      infoError = e instanceof Error ? e.message : String(e);
    }
  }
  if (!photo) problems.push(`Missing ${photoPath(root)}`);
  if (!info) problems.push(infoError ? `child/info.json invalid: ${infoError}` : "Missing child/info.json");
  return { scenes, child: { photo, info, name, gender, infoError }, ready: problems.length === 0, problems };
}
