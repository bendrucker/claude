#!/usr/bin/env bun

import { resolve } from "node:path";
import {
  createCanvas,
  GlobalFonts,
  type Image,
  loadImage,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { cli } from "cleye";
import sharp from "sharp";
import {
  captionBarHeight,
  defaultValign,
  type FitResult,
  fitText,
  type Measure,
  type PxRegion,
  padRegion,
  resolveRegion,
} from "./layout";
import {
  type Anchor,
  caption as captionStyle,
  LINE_HEIGHT,
  MIN_STROKE_PX,
  type PresetStyle,
  presets,
} from "./presets";
import { type Caption, type Spec, specFromFlags, type TextBox, validateSpec } from "./spec";

/** Below this width, text at readable px sizes crowds the image; upscale 2x first. */
const MIN_WIDTH = 400;

const IMPACT_PATH = "/System/Library/Fonts/Supplemental/Impact.ttf";

let cachedFamily: string | undefined;

async function classicFontFamily(): Promise<string> {
  if (cachedFamily) return cachedFamily;
  if (await Bun.file(IMPACT_PATH).exists()) {
    GlobalFonts.registerFromPath(IMPACT_PATH, "Impact");
    cachedFamily = "Impact";
  } else if (GlobalFonts.has("Arial Black")) {
    cachedFamily = "Arial Black";
  } else {
    cachedFamily = "sans-serif";
  }
  return cachedFamily;
}

interface ResolvedFont {
  family: string;
  weight: "normal" | "bold";
}

function fontString(font: ResolvedFont, px: number): string {
  return `${font.weight} ${px}px ${JSON.stringify(font.family)}`;
}

function measurer(ctx: SKRSContext2D, font: ResolvedFont): Measure {
  return (text, fontPx) => {
    ctx.font = fontString(font, fontPx);
    return ctx.measureText(text).width;
  };
}

export interface RenderResult {
  outPath: string;
  width: number;
  height: number;
  bars: { top: number; bottom: number };
  warnings: string[];
}

interface CaptionLayout {
  caption: Caption;
  lines: string[];
  fontPx: number;
  barHeight: number;
}

function layoutCaptions(
  captions: Caption[],
  imageWidth: number,
  imageHeight: number,
  ctx: SKRSContext2D,
): CaptionLayout[] {
  const font: ResolvedFont = { family: captionStyle.fontFamily, weight: captionStyle.fontWeight };
  const measure = measurer(ctx, font);
  const padPx = captionStyle.padding * imageWidth;
  return captions.map((caption) => {
    const fontPx = Math.round(captionStyle.fontSize * imageHeight);
    const lines = fitText(caption.text, {
      maxWidth: imageWidth - 2 * padPx,
      maxHeight: Number.POSITIVE_INFINITY,
      maxFontPx: fontPx,
      minFontPx: fontPx,
      measure,
    }).lines;
    return { caption, lines, fontPx, barHeight: captionBarHeight(lines.length, fontPx, padPx) };
  });
}

function drawCaption(ctx: SKRSContext2D, layout: CaptionLayout, y: number, width: number): void {
  const font: ResolvedFont = { family: captionStyle.fontFamily, weight: captionStyle.fontWeight };
  const padPx = captionStyle.padding * width;
  ctx.fillStyle = captionStyle.background;
  ctx.fillRect(0, y, width, layout.barHeight);
  ctx.fillStyle = captionStyle.fill;
  ctx.font = fontString(font, layout.fontPx);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  layout.lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, y + padPx + i * layout.fontPx * LINE_HEIGHT);
  });
}

interface BoxLayout {
  box: TextBox;
  preset: PresetStyle;
  font: ResolvedFont;
  region: PxRegion;
  anchor: Anchor;
  fit: FitResult;
}

function layoutBox(
  ctx: SKRSContext2D,
  box: TextBox,
  imageWidth: number,
  imageHeight: number,
  classicFamily: string,
  fontPxCap?: number,
): BoxLayout {
  const preset = presets[box.preset ?? "classic"];
  const family =
    box.style?.font ?? (preset.fontFamily === "Impact" ? classicFamily : preset.fontFamily);
  const font: ResolvedFont = { family, weight: preset.fontWeight };
  const measure = measurer(ctx, font);

  const anchor = box.anchor ?? preset.defaultAnchor;
  const region = padRegion(resolveRegion({ anchor, region: box.region }, imageWidth, imageHeight));
  const uppercase = box.style?.uppercase ?? preset.uppercase;
  const text = uppercase ? box.text.toUpperCase() : box.text;

  const maxFontPx = (box.style?.fontSize ?? preset.maxFontSize) * imageHeight;
  const fit = fitText(text, {
    maxWidth: region.w,
    maxHeight: region.h,
    maxFontPx: fontPxCap === undefined ? maxFontPx : Math.min(maxFontPx, fontPxCap),
    minFontPx: preset.minFontSize * imageHeight,
    measure,
  });
  return { box, preset, font, region, anchor, fit };
}

/**
 * Multi-panel formats read wrong when each panel fits its text independently,
 * so linkFontSizes re-lays every box at the smallest fitted size.
 */
export function layoutBoxes(
  ctx: SKRSContext2D,
  spec: Spec,
  imageWidth: number,
  imageHeight: number,
  classicFamily: string,
): BoxLayout[] {
  const layouts = (spec.boxes ?? []).map((box) =>
    layoutBox(ctx, box, imageWidth, imageHeight, classicFamily),
  );
  if (!spec.linkFontSizes || layouts.length < 2) return layouts;
  const minPx = Math.min(...layouts.map((l) => l.fit.fontPx));
  return layouts.map((l) =>
    l.fit.fontPx > minPx ? layoutBox(ctx, l.box, imageWidth, imageHeight, classicFamily, minPx) : l,
  );
}

function drawBox(
  ctx: SKRSContext2D,
  layout: BoxLayout,
  offsetY: number,
  warnings: string[],
  index: number,
): void {
  const { box, preset, font, region, anchor, fit } = layout;
  if (fit.overflow) {
    warnings.push(
      `box ${index}: text does not fit at the minimum font size; it renders anyway but may spill out of its region. Shorten the text or enlarge the region.`,
    );
  }

  const align = box.align ?? "center";
  const x =
    align === "left" ? region.x : align === "right" ? region.x + region.w : region.x + region.w / 2;
  const blockHeight = fit.lines.length * fit.fontPx * LINE_HEIGHT;
  const valign = defaultValign(box, anchor);
  const yStart =
    valign === "top"
      ? region.y
      : valign === "bottom"
        ? region.y + region.h - blockHeight
        : region.y + (region.h - blockHeight) / 2;

  ctx.font = fontString(font, fit.fontPx);
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(MIN_STROKE_PX, fit.fontPx * preset.strokeWidthRatio);
  ctx.strokeStyle = box.style?.stroke ?? preset.stroke;
  ctx.fillStyle = box.style?.fill ?? preset.fill;
  fit.lines.forEach((line, i) => {
    const y = offsetY + yStart + i * fit.fontPx * LINE_HEIGHT;
    ctx.strokeText(line, x, y);
    ctx.fillText(line, x, y);
  });
}

export async function render(
  spec: Spec,
  inputPath: string,
  outPath: string,
): Promise<RenderResult> {
  let buffer = await sharp(inputPath).rotate().png().toBuffer();
  let image: Image = await loadImage(buffer);
  if (image.width < MIN_WIDTH) {
    buffer = await sharp(buffer)
      .resize(image.width * 2)
      .png()
      .toBuffer();
    image = await loadImage(buffer);
  }

  const scratch = createCanvas(1, 1).getContext("2d");
  const captionLayouts = layoutCaptions(spec.captions ?? [], image.width, image.height, scratch);
  const topCaptions = captionLayouts.filter((l) => (l.caption.position ?? "top") === "top");
  const bottomCaptions = captionLayouts.filter((l) => (l.caption.position ?? "top") === "bottom");
  const bars = {
    top: topCaptions.reduce((sum, l) => sum + l.barHeight, 0),
    bottom: bottomCaptions.reduce((sum, l) => sum + l.barHeight, 0),
  };

  const canvas = createCanvas(image.width, image.height + bars.top + bars.bottom);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, bars.top);

  let y = 0;
  for (const layout of topCaptions) {
    drawCaption(ctx, layout, y, image.width);
    y += layout.barHeight;
  }
  y = bars.top + image.height;
  for (const layout of bottomCaptions) {
    drawCaption(ctx, layout, y, image.width);
    y += layout.barHeight;
  }

  const warnings: string[] = [];
  const classic = await classicFontFamily();
  layoutBoxes(ctx, spec, image.width, image.height, classic).forEach((layout, i) => {
    drawBox(ctx, layout, bars.top, warnings, i);
  });

  const absolute = resolve(outPath);
  await Bun.write(absolute, await canvas.encode("png"));
  return { outPath: absolute, width: canvas.width, height: canvas.height, bars, warnings };
}

if (import.meta.main) {
  const argv = cli({
    name: "render",
    parameters: ["<image>"],
    help: {
      description: "Overlay meme text on an image and write a PNG.",
    },
    flags: {
      top: { type: String, description: "Classic Impact macro text at the top" },
      bottom: { type: String, description: "Classic Impact macro text at the bottom" },
      subtitle: { type: String, description: "TV-subtitle text at the bottom" },
      caption: { type: String, description: "White-bar caption text (expands the canvas)" },
      captionPosition: {
        type: String,
        description: "Caption bar placement: top or bottom (default: top)",
      },
      spec: {
        type: String,
        alias: "s",
        description: "Path to a JSON layout spec file (mutually exclusive with text flags)",
      },
      out: { type: String, alias: "o", description: "Output PNG path (required)" },
    },
  });

  const { top, bottom, subtitle, caption, captionPosition, spec: specPath, out } = argv.flags;
  if (!out) {
    console.error("error: --out is required");
    process.exit(1);
  }
  if (specPath && (top || bottom || subtitle || caption || captionPosition)) {
    console.error("error: --spec is mutually exclusive with --top/--bottom/--subtitle/--caption");
    process.exit(1);
  }

  try {
    const spec = specPath
      ? validateSpec(await Bun.file(specPath).json())
      : specFromFlags({ top, bottom, subtitle, caption, captionPosition });
    const result = await render(spec, argv._.image, out);
    for (const warning of result.warnings) {
      console.error(`warning: ${warning}`);
    }
    console.log(result.outPath);
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
