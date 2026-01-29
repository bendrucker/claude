import { extname, resolve } from "node:path";

import { chromium } from "playwright";

export interface RenderOptions {
  scale?: number;
}

export interface RenderResult {
  input: string;
  output: string;
  scale: number;
}

export async function renderFile(
  inputPath: string,
  outputPath?: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const scale = options.scale ?? 1;
  const suffix = scale > 1 ? `@${scale}x` : "";
  const absInput = resolve(inputPath);
  const output = outputPath ?? absInput.replace(/\.html$/, `${suffix}.png`);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`file://${absInput}`, { waitUntil: "networkidle" });

    const element = await page.$("body > div");
    if (!element) {
      throw new Error("No root div found in HTML");
    }

    const box = await element.boundingBox();
    if (!box) {
      throw new Error("Could not get bounding box");
    }

    await page.setViewportSize({
      width: Math.ceil(box.width),
      height: Math.ceil(box.height),
    });

    await element.screenshot({
      path: output,
      scale: "device",
    });

    return { input: inputPath, output, scale };
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let scale = 1;
  const files: string[] = [];
  let outputPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--scale" && args[i + 1]) {
      scale = parseInt(args[i + 1], 10);
      i++;
    } else if (extname(args[i] as string) === ".html") {
      files.push(args[i] as string);
    } else if (extname(args[i] as string) === ".png") {
      outputPath = args[i];
    }
  }

  if (files.length === 0) {
    console.error("Usage: render-html.ts [--scale N] <html-file> [output.png]");
    process.exit(1);
  }

  for (const file of files) {
    try {
      const result = await renderFile(file, outputPath, { scale });
      console.log(`Rendered ${result.input} to ${result.output}`);
    } catch (error) {
      console.error(`Failed ${file}: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  }
}
