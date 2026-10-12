import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

test("favicon contains the existing Continental mark at every supported size", async () => {
  const icon = await readFile(new URL("../src/app/favicon.ico", import.meta.url));
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  const sizes = [16, 32, 48, 64, 256];
  assert.equal(icon.readUInt16LE(4), sizes.length);
  let nextOffset = 6 + sizes.length * 16;
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16;
    assert.equal(icon[entry] || 256, size);
    assert.equal(icon[entry + 1] || 256, size);
    assert.equal(icon.readUInt16LE(entry + 6), 32);
    const length = icon.readUInt32LE(entry + 8);
    const offset = icon.readUInt32LE(entry + 12);
    assert.equal(offset, nextOffset);
    nextOffset += length;
    const embedded = icon.subarray(offset, offset + length);
    const metadata = await sharp(embedded).metadata();
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
    assert.equal(metadata.hasAlpha, true);
    const expected = await sharp(fileURLToPath(new URL("../src/assets/mark-gold.png", import.meta.url)))
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();
    assert.deepEqual(embedded, expected);
  }
  assert.equal(icon.length, nextOffset);
});
