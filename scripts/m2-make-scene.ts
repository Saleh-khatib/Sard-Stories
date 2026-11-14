import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { generateImage, imagePart, makeClient } from "../src/pipeline/genai";
import { loadSettings } from "../src/settings/load";

// Generates a SYNTHETIC acceptance scene for M2: a three-panel collage (child, teen, adult from behind) with a printed shirt.
const settings = await loadSettings();
const client = makeClient(settings);
const style = await readFile("test-data/scenes/front.png");
const prompt =
  "Create a children's picture-book illustration page in exactly the same soft hand-painted watercolour storybook style as the reference image. It is a COLLAGE of three equal panels side by side, separated by thin white borders. " +
  "LEFT panel: a young boy about 6 years old with short brown hair and a red jacket, standing in a sunny park, facing the viewer. " +
  "MIDDLE panel: the same boy as a teenager about 15 years old in a green football kit, seen in full profile facing right, kicking a football on a pitch. " +
  "RIGHT panel: the same person as a grown adult footballer, seen from BEHIND, in a green football shirt with the name ALI in large white block capitals above the number 7 printed across the back of the shirt, standing in a stadium. " +
  "Every head must be fully visible and large, with no hats, and each panel must show only one person. Do not add any other text anywhere.";
const img = await generateImage(client, settings, { model: "gemini-3-pro-image", parts: [imagePart(style), { text: prompt }], size: "2K", aspectRatio: "3:2", seed: null });
await mkdir("test-data/m2", { recursive: true });
await writeFile("test-data/m2/collage.png", img.png);
console.log(`collage ${img.width}x${img.height}, $${img.costUsd.toFixed(3)}`);
