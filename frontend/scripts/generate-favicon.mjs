import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Package the existing brand mark as a multi-resolution ICO. Run manually when
// the logo changes; the generated file is committed, so deployments do no work.
const source = new URL("../src/assets/mark-gold.png", import.meta.url);
const target = new URL("../src/app/favicon.ico", import.meta.url);
const sizes = [16, 32, 48, 64, 256];
const images = await Promise.all(sizes.map((size) => sharp(fileURLToPath(source))
  .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer()));

const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2); // ICO, not a cursor.
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (let index = 0; index < sizes.length; index += 1) {
  const entry = 6 + index * 16;
  directory[entry] = sizes[index] % 256; // ICO encodes 256px as zero.
  directory[entry + 1] = sizes[index] % 256;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}

await writeFile(target, Buffer.concat([directory, ...images]));
console.log(`Continental favicon generated (${sizes.join(", ")}px).`);
