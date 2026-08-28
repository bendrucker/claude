import { z } from "zod";
import { Anchor, PresetName } from "./presets";

const fraction = z.number().min(0).max(1);
const text = z.string().min(1);

export const Region = z.object({ x: fraction, y: fraction, w: fraction, h: fraction });
export type Region = z.infer<typeof Region>;

export const StyleOverrides = z.object({
  fill: text.optional(),
  stroke: text.optional(),
  /** Font size as a fraction of image height. */
  fontSize: fraction.optional(),
  font: text.optional(),
  uppercase: z.boolean().optional(),
});
export type StyleOverrides = z.infer<typeof StyleOverrides>;

export const TextBox = z
  .object({
    text,
    preset: PresetName.optional(),
    anchor: Anchor.optional(),
    region: Region.optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    valign: z.enum(["top", "middle", "bottom"]).optional(),
    style: StyleOverrides.optional(),
  })
  .refine((box) => box.anchor === undefined || box.region === undefined, {
    error: "anchor and region are mutually exclusive",
  });
export type TextBox = z.infer<typeof TextBox>;

export const Caption = z.object({
  text,
  position: z.enum(["top", "bottom"]).optional(),
});
export type Caption = z.infer<typeof Caption>;

export const Spec = z
  .object({
    boxes: z.array(TextBox).optional(),
    captions: z.array(Caption).optional(),
    /** Re-fit all boxes at the smallest fitted font size so panels match. */
    linkFontSizes: z.boolean().optional(),
  })
  .refine((spec) => (spec.boxes?.length ?? 0) + (spec.captions?.length ?? 0) > 0, {
    error: "requires at least one box or caption",
  });
export type Spec = z.infer<typeof Spec>;

class SpecError extends Error {}

function fail(path: string, message: string): never {
  throw new SpecError(`${path}: ${message}`);
}

export function validateSpec(value: unknown): Spec {
  const result = Spec.safeParse(value);
  if (!result.success) throw new SpecError(z.prettifyError(result.error));
  return result.data;
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
