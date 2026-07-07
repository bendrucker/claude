import { type Anchor, type PresetName, presets } from "./presets";

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StyleOverrides {
  fill?: string;
  stroke?: string;
  /** Font size as a fraction of image height. */
  fontSize?: number;
  font?: string;
  uppercase?: boolean;
}

export interface TextBox {
  text: string;
  preset?: PresetName;
  anchor?: Anchor;
  region?: Region;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  style?: StyleOverrides;
}

export interface Caption {
  text: string;
  position?: "top" | "bottom";
}

export interface Spec {
  boxes?: TextBox[];
  captions?: Caption[];
}

const anchors: Anchor[] = ["top", "bottom", "center"];
const presetNames = Object.keys(presets) as PresetName[];

class SpecError extends Error {}

function fail(path: string, message: string): never {
  throw new SpecError(`${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function validateFraction(value: unknown, path: string): number {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    fail(path, `expected a number between 0 and 1, got ${JSON.stringify(value)}`);
  }
  return value;
}

function validateRegion(value: unknown, path: string): Region {
  if (!isRecord(value)) fail(path, "expected an object {x, y, w, h}");
  for (const key of ["x", "y", "w", "h"]) {
    validateFraction(value[key], `${path}.${key}`);
  }
  return value as unknown as Region;
}

function validateBox(value: unknown, path: string): TextBox {
  if (!isRecord(value)) fail(path, "expected an object");
  if (typeof value.text !== "string" || value.text.length === 0) {
    fail(`${path}.text`, "required non-empty string");
  }
  if (value.preset !== undefined && !presetNames.includes(value.preset as PresetName)) {
    fail(`${path}.preset`, `expected one of ${presetNames.join(", ")}`);
  }
  if (value.anchor !== undefined && value.region !== undefined) {
    fail(path, "anchor and region are mutually exclusive");
  }
  if (value.anchor !== undefined && !anchors.includes(value.anchor as Anchor)) {
    fail(`${path}.anchor`, `expected one of ${anchors.join(", ")}`);
  }
  if (value.region !== undefined) validateRegion(value.region, `${path}.region`);
  if (value.align !== undefined && !["left", "center", "right"].includes(value.align as string)) {
    fail(`${path}.align`, "expected left, center, or right");
  }
  if (value.valign !== undefined && !["top", "middle", "bottom"].includes(value.valign as string)) {
    fail(`${path}.valign`, "expected top, middle, or bottom");
  }
  if (value.style !== undefined) {
    if (!isRecord(value.style)) fail(`${path}.style`, "expected an object");
    if (value.style.fontSize !== undefined) {
      validateFraction(value.style.fontSize, `${path}.style.fontSize`);
    }
  }
  return value as unknown as TextBox;
}

function validateCaption(value: unknown, path: string): Caption {
  if (!isRecord(value)) fail(path, "expected an object");
  if (typeof value.text !== "string" || value.text.length === 0) {
    fail(`${path}.text`, "required non-empty string");
  }
  if (value.position !== undefined && !["top", "bottom"].includes(value.position as string)) {
    fail(`${path}.position`, "expected top or bottom");
  }
  return value as unknown as Caption;
}

export function validateSpec(value: unknown): Spec {
  if (!isRecord(value)) fail("spec", "expected an object with boxes and/or captions");
  const boxes = value.boxes;
  const captions = value.captions;
  if (boxes === undefined && captions === undefined) {
    fail("spec", "requires at least one of boxes or captions");
  }
  if (boxes !== undefined && !Array.isArray(boxes)) fail("spec.boxes", "expected an array");
  if (captions !== undefined && !Array.isArray(captions)) {
    fail("spec.captions", "expected an array");
  }
  const spec: Spec = {};
  if (Array.isArray(boxes)) {
    spec.boxes = boxes.map((box, i) => validateBox(box, `spec.boxes[${i}]`));
  }
  if (Array.isArray(captions)) {
    spec.captions = captions.map((c, i) => validateCaption(c, `spec.captions[${i}]`));
  }
  if ((spec.boxes?.length ?? 0) + (spec.captions?.length ?? 0) === 0) {
    fail("spec", "requires at least one box or caption");
  }
  return spec;
}

export interface TextFlags {
  top?: string | undefined;
  bottom?: string | undefined;
  subtitle?: string | undefined;
  caption?: string | undefined;
  captionPosition?: string | undefined;
}

export function specFromFlags(flags: TextFlags): Spec {
  const spec: Spec = {};
  const boxes: TextBox[] = [];
  if (flags.top) boxes.push({ text: flags.top, preset: "classic", anchor: "top" });
  if (flags.bottom) boxes.push({ text: flags.bottom, preset: "classic", anchor: "bottom" });
  if (flags.subtitle) boxes.push({ text: flags.subtitle, preset: "subtitle" });
  if (boxes.length > 0) spec.boxes = boxes;
  if (flags.caption) {
    const position = flags.captionPosition ?? "top";
    if (position !== "top" && position !== "bottom") {
      fail("--caption-position", "expected top or bottom");
    }
    spec.captions = [{ text: flags.caption, position }];
  }
  if (!spec.boxes && !spec.captions) {
    fail("flags", "requires at least one of --top, --bottom, --subtitle, --caption, or --spec");
  }
  return spec;
}
