import "server-only";
import sharp from "sharp";

export async function preparePhoto(value: string | null | undefined) {
  if (value === undefined || value === null) return value;
  const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error("Upload a JPEG, PNG or WebP photo.");
  const input = Buffer.from(match[1], "base64");
  if (!input.length || input.length > 2 * 1024 * 1024) throw new Error("Photo must be at most 2 MB.");
  try {
    const source = sharp(input, { limitInputPixels: 16000000, animated: false, failOn: "warning" });
    const metadata = await source.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format || "") || (metadata.pages ?? 1) > 1) throw new Error();
    // Re-encoding drops metadata and embedded content. Never serve original uploads or SVG.
    const output = await source.rotate().resize(1000, 1000, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    if (output.length > 512 * 1024) throw new Error();
    return output.toString("base64");
  } catch { throw new Error("Photo could not be processed. Use a smaller, still JPEG, PNG or WebP image."); }
}
