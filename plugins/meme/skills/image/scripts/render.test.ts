import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { render } from "./render";

const dir = mkdtempSync(join(tmpdir(), "meme-render-"));
const png = join(dir, "input.png");
const jpeg = join(dir, "input.jpeg");
const tiny = join(dir, "tiny.png");

beforeAll(async () => {
  const base = sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 40, g: 80, b: 160 } },
  });
  await base.clone().png().toFile(png);
  await base.clone().jpeg().toFile(jpeg);
  await sharp({
    create: { width: 120, height: 90, channels: 3, background: { r: 200, g: 60, b: 60 } },
  })
    .png()
    .toFile(tiny);
});

test("classic macro renders a decodable PNG at input dimensions", async () => {
  const out = join(dir, "classic.png");
  const result = await render(
    { boxes: [{ text: "one does not simply", anchor: "top" }] },
    png,
    out,
  );
  expect(result.warnings).toEqual([]);
  const meta = await sharp(out).metadata();
  expect({ format: meta.format, width: meta.width, height: meta.height }).toEqual({
    format: "png",
    width: 800,
    height: 600,
  });
});

test("caption bar grows the canvas by the computed bar height", async () => {
  const out = join(dir, "caption.png");
  const result = await render(
    { captions: [{ text: "me explaining the joke", position: "top" }] },
    png,
    out,
  );
  expect(result.bars.top).toBeGreaterThan(0);
  const meta = await sharp(out).metadata();
  expect(meta.height).toBe(600 + result.bars.top);
  expect(result.height).toBe(600 + result.bars.top);
});

test("jpeg input produces png output", async () => {
  const out = join(dir, "from-jpeg.png");
  await render({ boxes: [{ text: "still a png" }] }, jpeg, out);
  const meta = await sharp(out).metadata();
  expect(meta.format).toBe("png");
});

test("images narrower than 400px upscale 2x", async () => {
  const out = join(dir, "tiny.png");
  const result = await render({ boxes: [{ text: "tiny" }] }, tiny, out);
  expect({ width: result.width, height: result.height }).toEqual({ width: 240, height: 180 });
});

test("text that cannot fit warns instead of erroring", async () => {
  const out = join(dir, "overflow.png");
  const result = await render(
    {
      boxes: [
        {
          text: "an extremely long string of meme text that has no hope of fitting here",
          region: { x: 0.45, y: 0.45, w: 0.1, h: 0.05 },
        },
      ],
    },
    png,
    out,
  );
  expect(result.warnings.length).toBe(1);
  expect(result.warnings[0]).toContain("does not fit");
});
