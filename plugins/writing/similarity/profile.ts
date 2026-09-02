// The cached artifact the scorer reads, so warm scoring never touches the
// corpus. Holds no corpus text.

import { z } from "zod";
import { Calibration } from "./calibration";
import { RHYTHM_FEATURE_IDS } from "./rhythm";

export const SCHEMA_VERSION = 1;

export const Pole = z.object({
  documentCount: z.number(),
  wordCount: z.number(),
  // Mean and per-feature spread in the pooled standardized space.
  rhythmCentroid: z.array(z.number()),
  rhythmSpread: z.array(z.number()),
  // Relative frequencies over charVocabulary, aggregated across the pole.
  charProfile: z.array(z.number()),
  sources: z.array(z.string()),
});
export type Pole = z.infer<typeof Pole>;

// The two poles plus the transforms that put an input into their space. Scoring
// needs exactly this much, so build-time calibration can score against a
// half-built profile.
export const Poles = z.object({
  featureIds: z.array(z.string()),
  scaler: z.object({ mean: z.array(z.number()), sd: z.array(z.number()) }),
  charVocabulary: z.array(z.string()),
  voice: Pole,
  contrast: Pole,
});
export type Poles = z.infer<typeof Poles>;

export const CalibrationSet = z.object({
  rhythm: Calibration,
  char: Calibration,
  fused: Calibration,
});
export type CalibrationSet = z.infer<typeof CalibrationSet>;

export const StyleProfile = Poles.extend({
  version: z.literal(SCHEMA_VERSION),
  generatedAt: z.string(),
  windowSentences: z.number(),
  documentCalibration: CalibrationSet,
  windowCalibration: CalibrationSet,
});
export type StyleProfile = z.infer<typeof StyleProfile>;

export class StaleProfileError extends Error {
  constructor(path: string, detail: string) {
    super(`Similarity profile at ${path} is stale: ${detail}. Run \`similarity.ts build\` again.`);
    this.name = "StaleProfileError";
  }
}

// Every distance is taken index-by-index against the stored arrays, so a
// profile built from a different feature table scores a document against the
// wrong columns and returns a plausible number. Nothing downstream can detect
// that, which is why it is rejected here.
function checkAlignment(path: string, profile: StyleProfile): void {
  const stored = profile.featureIds;
  if (
    stored.length !== RHYTHM_FEATURE_IDS.length ||
    stored.some((id, i) => id !== RHYTHM_FEATURE_IDS[i])
  ) {
    throw new StaleProfileError(path, "its feature list differs from the current one");
  }
  const widths = [
    profile.scaler.mean.length,
    profile.scaler.sd.length,
    profile.voice.rhythmCentroid.length,
    profile.voice.rhythmSpread.length,
    profile.contrast.rhythmCentroid.length,
    profile.contrast.rhythmSpread.length,
  ];
  if (widths.some((width) => width !== stored.length)) {
    throw new StaleProfileError(path, "its stored vectors do not match its feature list");
  }
}

export async function loadStyleProfile(path: string): Promise<StyleProfile | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const parsed = StyleProfile.safeParse(await file.json());
  if (!parsed.success) {
    throw new StaleProfileError(path, "it does not match the current schema");
  }
  checkAlignment(path, parsed.data);
  return parsed.data;
}

export async function saveStyleProfile(path: string, profile: StyleProfile): Promise<void> {
  await Bun.write(path, `${JSON.stringify(profile)}\n`);
}
