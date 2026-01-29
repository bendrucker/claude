import { readFile, writeFile } from "node:fs/promises";

import sharp from "sharp";

export interface RenderOptions {
  scale?: number;
}

export interface RenderResult {
  input: string;
  output: string;
  scale: number;
}

export async function render(
  svgContent: Buffer | string,
  outputPath: string,
  options: RenderOptions = {},
): Promise<void> {
  const { scale = 1 } = options;

  let pipeline = sharp(svgContent);

  if (scale !== 1) {
    const metadata = await sharp(svgContent).metadata();
    if (metadata.width && metadata.height) {
      pipeline = pipeline.resize(
        Math.round(metadata.width * scale),
        Math.round(metadata.height * scale),
      );
    }
  }

  const pngBuffer = await pipeline.png().toBuffer();
  await writeFile(outputPath, pngBuffer);
}

export async function renderFile(
  inputPath: string,
  outputPath?: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const scale = options.scale ?? 1;
  const suffix = scale !== 1 ? `@${scale}x` : "";
  const output = outputPath || inputPath.replace(/\.svg$/, `${suffix}.png`);
  const content = await readFile(inputPath);
  await render(content, output, options);
  return { input: inputPath, output, scale };
}

export async function renderFiles(
  files: Array<{ input: string; output?: string }>,
  options: RenderOptions = {},
): Promise<RenderResult[]> {
  return Promise.all(files.map(({ input, output }) => renderFile(input, output, options)));
}

async function main() {
  const args = process.argv.slice(2);

  let scale = 1;
  const scaleIndex = args.findIndex((a) => a === "--scale" || a === "-s");
  if (scaleIndex !== -1) {
    scale = Number.parseFloat(args[scaleIndex + 1] ?? "1") || 1;
    args.splice(scaleIndex, 2);
  }

  if (args.length === 0) {
    console.error("Usage: bun render.ts [--scale N] <svg-file> [output.png] | <svg-file>...");
    console.error("");
    console.error("Options:");
    console.error("  --scale, -s  Scale factor (default: 1, use 2 for @2x retina)");
    process.exit(1);
  }

  const svgFiles = args.filter((f) => f.endsWith(".svg"));
  const nonSvgArgs = args.filter((f) => !f.endsWith(".svg"));

  const files: Array<{ input: string; output?: string }> = [];

  if (svgFiles.length === 1 && nonSvgArgs.length === 1) {
    files.push({ input: svgFiles[0] as string, ...(nonSvgArgs[0] && { output: nonSvgArgs[0] }) });
  } else if (svgFiles.length > 0) {
    files.push(...svgFiles.map((input) => ({ input })));
  } else if (args.length >= 1) {
    files.push({ input: args[0] as string, ...(args[1] && { output: args[1] }) });
  }

  try {
    const results = await renderFiles(files, { scale });
    for (const { input, output, scale: s } of results) {
      const scaleStr = s !== 1 ? ` (${s}x)` : "";
      console.log(`✓ ${input} → ${output}${scaleStr}`);
    }
  } catch (error) {
    console.error("Failed to render:", error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("/bun")) {
  main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
}
