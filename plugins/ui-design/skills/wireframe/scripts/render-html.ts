import { extname, resolve } from "node:path";

import { cli } from "cleye";
import { type Browser, chromium } from "playwright";

export interface RenderOptions {
  scale?: number;
  browser?: Browser;
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

  const owned = !options.browser;
  const browser = options.browser ?? (await chromium.launch());
  try {
    const page = await browser.newPage();
    await page.goto(`file://${absInput}`, { waitUntil: "domcontentloaded" });

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
    if (owned) {
      await browser.close();
    }
  }
}

if (import.meta.main) {
  const argv = cli({
    name: "render-html",
    parameters: ["<files...>"],
    flags: {
      scale: {
        type: Number,
        description: "Scale factor for rendering",
        default: 1,
      },
    },
  });

  const args = argv._.files;
  const scale = argv.flags.scale;

  const lastArg = args[args.length - 1];
  const hasOutputPath = lastArg !== undefined && extname(lastArg) === ".png";
  const outputPath = hasOutputPath ? lastArg : undefined;
  const files = hasOutputPath ? args.slice(0, -1) : args;

  if (files.length === 0) {
    console.error("No HTML files provided");
    process.exit(1);
  }

  if (hasOutputPath && files.length > 1) {
    console.error("Cannot specify output path with multiple input files");
    process.exit(1);
  }

  for (const file of files) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- each render drives a headless browser and prints its result before the next starts.
      const result = await renderFile(file, outputPath, { scale });
      console.log(`Rendered ${result.input} to ${result.output}`);
    } catch (error) {
      console.error(`Failed ${file}: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
}
