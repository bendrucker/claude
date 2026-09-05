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
    const { width, height } = await sharp(svgContent).metadata();
    if (width > 0 && height > 0) {
      pipeline = pipeline.resize(Math.round(width * scale), Math.round(height * scale));
    }
  }

  const pngBuffer = await pipeline.png().toBuffer();
  await Bun.write(outputPath, pngBuffer);
}

export async function renderFile(
  inputPath: string,
  outputPath?: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const scale = options.scale ?? 1;
  const suffix = scale !== 1 ? `@${scale}x` : "";
  const output =
    outputPath != null && outputPath !== ""
      ? outputPath
      : inputPath.replace(/\.svg$/, `${suffix}.png`);
  const content = Buffer.from(await Bun.file(inputPath).arrayBuffer());
  await render(content, output, options);
  return { input: inputPath, output, scale };
}

export async function renderFiles(
  files: { input: string; output?: string }[],
  options: RenderOptions = {},
): Promise<RenderResult[]> {
  return Promise.all(files.map(({ input, output }) => renderFile(input, output, options)));
}

async function main() {
  const args = process.argv.slice(2);

  let scale = 1;
  const scaleIndex = args.findIndex((a) => a === "--scale" || a === "-s");
  if (scaleIndex !== -1) {
    const parsed = Number.parseFloat(args[scaleIndex + 1] ?? "1");
    scale = Number.isNaN(parsed) || parsed === 0 ? 1 : parsed;
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

  const files: { input: string; output?: string }[] = [];

  const [svg] = svgFiles;
  const [firstArg, secondArg] = args;

  if (svg != null && svg !== "" && nonSvgArgs.length === 1) {
    files.push({
      input: svg,
      ...(nonSvgArgs[0] != null && nonSvgArgs[0] !== "" && { output: nonSvgArgs[0] }),
    });
  } else if (svgFiles.length > 0) {
    files.push(...svgFiles.map((input) => ({ input })));
  } else if (firstArg != null && firstArg !== "") {
    files.push({
      input: firstArg,
      ...(secondArg != null && secondArg !== "" && { output: secondArg }),
    });
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
  main().catch((error: unknown) => {
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
