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
  /** Re-fit all boxes at the smallest fitted font size so panels match. */
  linkFontSizes?: boolean;
}

const anchors: Anchor[] = ["top", "bottom", "center"];
const presetNames = Object.keys(presets) as PresetName[];

class SpecError extends Error {}

function fail(path: string, message: string): never {
  throw new SpecError(`${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateFraction(value: unknown, path: string): number {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    fail(path, `expected a number between 0 and 1, got ${JSON.stringify(value)}`);
  }
  return value;
}

function validateString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(path, "required non-empty string");
  }
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], path: string): T {
  if (typeof value !== "string" || !(options as readonly string[]).includes(value)) {
    fail(path, `expected one of ${options.join(", ")}`);
  }
  return value as T;
}

function validateRegion(value: unknown, path: string): Region {
  if (!isRecord(value)) fail(path, "expected an object {x, y, w, h}");
  return {
    x: validateFraction(value.x, `${path}.x`),
    y: validateFraction(value.y, `${path}.y`),
    w: validateFraction(value.w, `${path}.w`),
    h: validateFraction(value.h, `${path}.h`),
  };
}

function validateStyle(value: unknown, path: string): StyleOverrides {
  if (!isRecord(value)) fail(path, "expected an object");
  const style: StyleOverrides = {};
  if (value.fill !== undefined) style.fill = validateString(value.fill, `${path}.fill`);
  if (value.stroke !== undefined) style.stroke = validateString(value.stroke, `${path}.stroke`);
  if (value.fontSize !== undefined) {
    style.fontSize = validateFraction(value.fontSize, `${path}.fontSize`);
  }
  if (value.font !== undefined) style.font = validateString(value.font, `${path}.font`);
  if (value.uppercase !== undefined) {
    if (typeof value.uppercase !== "boolean") fail(`${path}.uppercase`, "expected a boolean");
    style.uppercase = value.uppercase;
  }
  return style;
}

function validateBox(value: unknown, path: string): TextBox {
  if (!isRecord(value)) fail(path, "expected an object");
  if (value.anchor !== undefined && value.region !== undefined) {
    fail(path, "anchor and region are mutually exclusive");
  }
  const box: TextBox = { text: validateString(value.text, `${path}.text`) };
  if (value.preset !== undefined) {
    box.preset = oneOf(value.preset, presetNames, `${path}.preset`);
  }
  if (value.anchor !== undefined) box.anchor = oneOf(value.anchor, anchors, `${path}.anchor`);
  if (value.region !== undefined) box.region = validateRegion(value.region, `${path}.region`);
  if (value.align !== undefined) {
    box.align = oneOf(value.align, ["left", "center", "right"], `${path}.align`);
  }
  if (value.valign !== undefined) {
    box.valign = oneOf(value.valign, ["top", "middle", "bottom"], `${path}.valign`);
  }
  if (value.style !== undefined) box.style = validateStyle(value.style, `${path}.style`);
  return box;
}

function validateCaption(value: unknown, path: string): Caption {
  if (!isRecord(value)) fail(path, "expected an object");
  const caption: Caption = { text: validateString(value.text, `${path}.text`) };
  if (value.position !== undefined) {
    caption.position = oneOf(value.position, ["top", "bottom"], `${path}.position`);
  }
  return caption;
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
  if (value.linkFontSizes !== undefined) {
    if (typeof value.linkFontSizes !== "boolean") {
      fail("spec.linkFontSizes", "expected a boolean");
    }
    spec.linkFontSizes = value.linkFontSizes;
  }
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
