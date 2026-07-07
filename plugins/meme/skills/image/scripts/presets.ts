export type PresetName = "classic" | "label" | "subtitle";
export type Anchor = "top" | "bottom" | "center";

export interface PresetStyle {
  fontFamily: string;
  fontWeight: "normal" | "bold";
  fill: string;
  stroke: string;
  /** Stroke width as a fraction of the rendered font size. */
  strokeWidthRatio: number;
  uppercase: boolean;
  /** Font size bounds as fractions of image height. */
  maxFontSize: number;
  minFontSize: number;
  defaultAnchor: Anchor;
}

export const LINE_HEIGHT = 1.15;
/** Inner padding on each side, as a fraction of the region dimension. */
export const REGION_PADDING = 0.04;
/** Absolute shrink floor in pixels, below which text is unreadable. */
export const MIN_FONT_PX = 12;

export const presets: Record<PresetName, PresetStyle> = {
  classic: {
    fontFamily: "Impact",
    fontWeight: "normal",
    fill: "#ffffff",
    stroke: "#000000",
    strokeWidthRatio: 1 / 12,
    uppercase: true,
    maxFontSize: 0.1,
    minFontSize: 0.028,
    defaultAnchor: "top",
  },
  label: {
    fontFamily: "Helvetica",
    fontWeight: "bold",
    fill: "#000000",
    stroke: "#ffffff",
    strokeWidthRatio: 1 / 18,
    uppercase: false,
    maxFontSize: 0.06,
    minFontSize: 0.02,
    defaultAnchor: "center",
  },
  subtitle: {
    fontFamily: "Helvetica",
    fontWeight: "bold",
    fill: "#ffe400",
    stroke: "#000000",
    strokeWidthRatio: 1 / 14,
    uppercase: false,
    maxFontSize: 0.045,
    minFontSize: 0.02,
    defaultAnchor: "bottom",
  },
};

export const caption = {
  fontFamily: "Helvetica",
  fontWeight: "bold" as const,
  fill: "#000000",
  background: "#ffffff",
  /** Font size as a fraction of image height. */
  fontSize: 0.05,
  minFontSize: 0.025,
  /** Bar padding as a fraction of image width. */
  padding: 0.04,
};
