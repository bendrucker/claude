import { z } from "zod";
import { angleSetSchema, type AngleSet } from "./efforts";

export const angleSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9-]*$/),
  name: z.string().describe("Heading the finder sees above its angle text."),
  kind: z.enum(["correctness", "cleanup", "altitude", "conventions"]),
  sets: z
    .array(angleSetSchema)
    .nonempty()
    .describe("Sets this angle belongs to. Stated rather than derived, so xhigh-only is explicit."),
  text: z.string(),
});

export const anglesSchema = z
  .strictObject({
    preamble: z
      .string()
      .describe("Candidate shape and the no-suppression rule, given to every finder."),
    angles: z.array(angleSchema).nonempty().describe("Angles in the order finders receive them."),
    cleanupPrecedence: z
      .string()
      .describe("Emitted when the selected set carries a cleanup, altitude, or conventions angle."),
    sweepGapFocus: z.string().describe("Emitted when the cell runs a sweep pass."),
  })
  .meta({
    title: "Review finder angles",
    description:
      "Finder angles for review:code, with the preamble and precedence blocks every finder receives.",
  });

export type Angle = z.infer<typeof angleSchema>;
export type Angles = z.infer<typeof anglesSchema>;

export function anglesIn({ angles }: Angles, set: AngleSet | null): Angle[] {
  return set === null ? [] : angles.filter((angle) => angle.sets.includes(set));
}
