// The classifier is calibrated here (see `calibrate.ts` against `labels.json`)
// but enforced by the pull-request hook, so the hook owns the source and the
// eval reads it. The reverse direction is impossible: plugins ship standalone
// and cannot import out of their own directory.
export { classifyPrHeading, type PrHeadingResult } from "../../scripts/sentence-heading";
