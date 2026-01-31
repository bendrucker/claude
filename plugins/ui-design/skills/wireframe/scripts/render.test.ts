import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { render, renderFile } from "./render";

const assetsDir = path.join(import.meta.dirname, "..", "assets");
const tmpDir = path.join(import.meta.dirname, "..", "tmp");

describe("render", () => {
  beforeAll(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("renders all asset files to PNG", async () => {
    const files = await readdir(assetsDir);
    const svgFiles = files.filter((f) => f.endsWith(".svg"));

    expect(svgFiles.length).toBeGreaterThan(0);

    const results = await Promise.all(
      svgFiles.map((file) =>
        renderFile(path.join(assetsDir, file), path.join(tmpDir, `wireframe-test-${file}.png`)),
      ),
    );

    for (const result of results) {
      expect(result.input).toContain(".svg");
      expect(result.output).toContain(".png");
      expect(result.scale).toBe(1);
    }
  });

  it("renders with 2x scale factor", async () => {
    const inputPath = path.join(assetsDir, "login-screen.svg");
    const outputPath = path.join(tmpDir, "login-screen@2x.png");

    const result = await renderFile(inputPath, outputPath, { scale: 2 });

    expect(result.scale).toBe(2);
    expect(result.output).toContain("@2x.png");

    const pngBuffer = await readFile(outputPath);
    expect(pngBuffer.length).toBeGreaterThan(0);
  });

  it("generates default output path with scale suffix", async () => {
    const inputPath = path.join(assetsDir, "login-screen.svg");
    const content = await readFile(inputPath);
    const outputPath = path.join(tmpDir, "scaled-output@2x.png");

    await render(content, outputPath, { scale: 2 });

    const pngBuffer = await readFile(outputPath);
    expect(pngBuffer.length).toBeGreaterThan(0);
  });

  it("throws on invalid SVG content", async () => {
    const invalidSvg = Buffer.from("not valid svg content");
    const outputPath = path.join(tmpDir, "invalid.png");

    await expect(render(invalidSvg, outputPath)).rejects.toThrow();
  });
});
