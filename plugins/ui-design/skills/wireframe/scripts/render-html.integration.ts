import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { type Browser, chromium } from "playwright";

import { renderFile } from "./render-html";

const fixturesDir = path.join(import.meta.dirname, "fixtures");
const tmpDir = path.join(import.meta.dirname, "..", "tmp");

describe("render-html", () => {
  let browser: Browser;

  beforeAll(async () => {
    await mkdir(tmpDir, { recursive: true });
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("renders HTML file to PNG", async () => {
    const inputPath = path.join(fixturesDir, "simple-wireframe.html");
    const outputPath = path.join(tmpDir, "simple-wireframe.png");

    const result = await renderFile(inputPath, outputPath, { browser });

    expect(result.input).toContain(".html");
    expect(result.output).toContain(".png");
    expect(result.scale).toBe(1);

    const pngBuffer = Buffer.from(await Bun.file(outputPath).arrayBuffer());
    expect(pngBuffer.length).toBeGreaterThan(0);
  });

  it("renders with 2x scale factor", async () => {
    const inputPath = path.join(fixturesDir, "simple-wireframe.html");
    const outputPath = path.join(tmpDir, "simple-wireframe@2x.png");

    const result = await renderFile(inputPath, outputPath, { scale: 2, browser });

    expect(result.scale).toBe(2);
    expect(result.output).toContain("@2x.png");

    const pngBuffer = Buffer.from(await Bun.file(outputPath).arrayBuffer());
    expect(pngBuffer.length).toBeGreaterThan(0);
  });

  it("throws when no root div found", () => {
    const inputPath = path.join(fixturesDir, "no-root-div.html");
    const outputPath = path.join(tmpDir, "no-root-div.png");

    expect(renderFile(inputPath, outputPath, { browser })).rejects.toThrow(
      "No root div found in HTML",
    );
  });

  it("throws when bounding box is null", () => {
    const inputPath = path.join(fixturesDir, "hidden-div.html");
    const outputPath = path.join(tmpDir, "hidden-div.png");

    expect(renderFile(inputPath, outputPath, { browser })).rejects.toThrow(
      "Could not get bounding box",
    );
  });
});
