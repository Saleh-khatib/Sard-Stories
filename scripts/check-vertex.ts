import "dotenv/config";
import sharp from "sharp";
import { GoogleGenAI } from "@google/genai";

const CANDIDATES = [
  "gemini-3-pro-image",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image",
];
const SIZES = ["1K", "2K", "4K"] as const;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
}

async function testImage(): Promise<string> {
  const png = await sharp({
    create: { width: 512, height: 512, channels: 3, background: "#f4efe6" },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="512" height="512"><circle cx="256" cy="256" r="120" fill="#d33"/></svg>`,
        ),
      },
    ])
    .png()
    .toBuffer();
  return png.toString("base64");
}

function errorStatus(e: unknown): string {
  const err = e as { status?: number; code?: number; message?: string };
  const code = err.status ?? err.code;
  const msg = (err.message ?? String(e)).replace(/\s+/g, " ").slice(0, 160);
  if (code === 404) return `404 (${msg})`;
  if (code === 429) return `429 (${msg})`;
  return `error ${code ?? ""} (${msg})`;
}

async function main() {
  const project = requireEnv("GOOGLE_CLOUD_PROJECT");
  const location = process.env.GOOGLE_CLOUD_LOCATION || "global";
  requireEnv("GOOGLE_APPLICATION_CREDENTIALS");

  const ai = new GoogleGenAI({ vertexai: true, project, location });
  const data = await testImage();
  console.log(`Vertex AI project=${project} location=${location}\n`);

  for (const model of CANDIDATES) {
    const rows: string[] = [];
    let status = "unknown";
    for (const size of SIZES) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: "image/png", data } },
                { text: "Change the red circle to blue. Keep everything else identical." },
              ],
            },
          ],
          config: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: "1:1", imageSize: size },
          },
        });
        const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        if (!part?.inlineData?.data) {
          rows.push(`${size}: no image returned`);
          if (status === "unknown") status = "available (no image for some sizes)";
          continue;
        }
        const meta = await sharp(Buffer.from(part.inlineData.data, "base64")).metadata();
        rows.push(`${size}: ${meta.width}x${meta.height}`);
        status = "available";
      } catch (e) {
        const s = errorStatus(e);
        rows.push(`${size}: ${s}`);
        if (status === "unknown" || status.startsWith("available (")) status = s;
      }
    }
    console.log(`${model}\n  status: ${status}\n  ${rows.join("\n  ")}\n`);
  }
}

main().catch((e) => {
  console.error(errorStatus(e));
  process.exit(1);
});
