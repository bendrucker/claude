import { type Anchor, LINE_HEIGHT, MIN_FONT_PX, REGION_PADDING } from "./presets";
import type { Region, TextBox } from "./spec";

/** Returns the rendered width in px of text at the given font size. */
export type Measure = (text: string, fontPx: number) => number;

export interface PxRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

const anchorRegions: Record<Anchor, Region> = {
  top: { x: 0.05, y: 0.02, w: 0.9, h: 0.3 },
  bottom: { x: 0.05, y: 0.68, w: 0.9, h: 0.3 },
  center: { x: 0.05, y: 0.35, w: 0.9, h: 0.3 },
};

export function resolveRegion(
  placement: { anchor?: Anchor | undefined; region?: Region | undefined },
  width: number,
  height: number,
): PxRegion {
  const region = placement.region ?? anchorRegions[placement.anchor ?? "top"];
  return {
    x: region.x * width,
    y: region.y * height,
    w: region.w * width,
    h: region.h * height,
  };
}

export function defaultValign(box: TextBox, anchor: Anchor): "top" | "middle" | "bottom" {
  if (box.valign) return box.valign;
  if (box.region) return "middle";
  if (anchor === "center") return "middle";
  return anchor;
}

export function padRegion(region: PxRegion): PxRegion {
  const padX = region.w * REGION_PADDING;
  const padY = region.h * REGION_PADDING;
  return {
    x: region.x + padX,
    y: region.y + padY,
    w: region.w - 2 * padX,
    h: region.h - 2 * padY,
  };
}

export function wrapText(
  text: string,
  maxWidth: number,
  fontPx: number,
  measure: Measure,
): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (current !== "" && measure(candidate, fontPx) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

export interface FitOptions {
  maxWidth: number;
  maxHeight: number;
  /** Font size bounds in px. */
  maxFontPx: number;
  minFontPx: number;
  measure: Measure;
}

export interface FitResult {
  fontPx: number;
  lines: string[];
  overflow: boolean;
}

function fits(lines: string[], fontPx: number, opts: FitOptions): boolean {
  const height = lines.length * fontPx * LINE_HEIGHT;
  if (height > opts.maxHeight) return false;
  return lines.every((line) => opts.measure(line, fontPx) <= opts.maxWidth);
}

/**
 * Wrap text at the largest font size that fits the region, shrinking in 5%
 * steps to the floor. Past the floor, returns the floor layout with
 * overflow: true so the caller can warn instead of erroring.
 */
export function fitText(text: string, opts: FitOptions): FitResult {
  const minFontPx = Math.max(MIN_FONT_PX, opts.minFontPx);
  let fontPx = Math.max(minFontPx, opts.maxFontPx);
  while (fontPx > minFontPx) {
    const lines = wrapText(text, opts.maxWidth, fontPx, opts.measure);
    if (fits(lines, fontPx, opts)) return { fontPx, lines, overflow: false };
    fontPx = Math.max(minFontPx, fontPx - Math.max(1, Math.round(fontPx * 0.05)));
  }
  const lines = wrapText(text, opts.maxWidth, minFontPx, opts.measure);
  return { fontPx: minFontPx, lines, overflow: !fits(lines, minFontPx, opts) };
}

export function captionBarHeight(lineCount: number, fontPx: number, padPx: number): number {
  return Math.ceil(lineCount * fontPx * LINE_HEIGHT + 2 * padPx);
}
