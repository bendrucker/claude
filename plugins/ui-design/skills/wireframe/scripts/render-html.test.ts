import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { renderFile } from "./render-html";

const fixturesDir = path.join(import.meta.dirname, "fixtures");
const tmpDir = path.join(import.meta.dirname, "..", "tmp");

describe("render-html", () => {
  beforeAll(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("renders HTML file to PNG", async () => {
    const inputPath = path.join(fixturesDir, "simple-wireframe.html");
    const outputPath = path.join(tmpDir, "simple-wireframe.png");

    const result = await renderFile(inputPath, outputPath);

    expect(result.input).toContain(".html");
    expect(result.output).toContain(".png");
    expect(result.scale).toBe(1);

    const pngBuffer = await readFile(outputPath);
    expect(pngBuffer.length).toBeGreaterThan(0);
  });

  it("renders with 2x scale factor", async () => {
    const inputPath = path.join(fixturesDir, "simple-wireframe.html");
    const outputPath = path.join(tmpDir, "simple-wireframe@2x.png");

    const result = await renderFile(inputPath, outputPath, { scale: 2 });

    expect(result.scale).toBe(2);
    expect(result.output).toContain("@2x.png");

    const pngBuffer = await readFile(outputPath);
    expect(pngBuffer.length).toBeGreaterThan(0);
  });

  it("throws when no root div found", async () => {
    const inputPath = path.join(fixturesDir, "no-root-div.html");
    const outputPath = path.join(tmpDir, "no-root-div.png");

    await expect(renderFile(inputPath, outputPath)).rejects.toThrow("No root div found in HTML");
  });
});
