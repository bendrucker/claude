import { describe, expect, it } from "bun:test";
import { classifyHeadingBaseline, type HeadingKind } from "./heading";

/**
 * The committed regression seed: the case table from the headings hook,
 * including its documented misses. classifyHeadingBaseline must match
 * checkSentenceHeading exactly.
 */
export const seedCases: {
  description: string;
  heading: string;
  flagged: boolean;
  kind?: HeadingKind;
}[] = [
  {
    description: "subject plus linking verb",
    heading: "Latency Is the Main Bottleneck",
    flagged: true,
    kind: "clause",
  },
  {
    description: "colon clause with not an",
    heading: "Rollback: A Safety Net, Not an Undo Button",
    flagged: true,
    kind: "clause",
  },
  {
    description: "colon clause with is the default",
    heading: "Caching Strategy: Write-Through Is the Default",
    flagged: true,
    kind: "clause",
  },
  {
    description: "relative clause with how/handle",
    heading: "Prior Art: How Other Brokers Handle This",
    flagged: true,
    kind: "clause",
  },
  {
    description: "imperative opener build",
    heading: "Build Against the Documented Limits",
    flagged: true,
    kind: "imperative",
  },
  {
    description: "relative clause with that and keep",
    heading: "Joints That Keep the Prototype From Becoming Debt",
    flagged: true,
    kind: "clause",
  },
  {
    description: "imperative list document/stabilize/expose",
    heading: "Document, Stabilize, and Expose the Internal Cache API",
    flagged: true,
    kind: "imperative",
  },
  {
    description: "parenthetical with trailing clause and linking verb",
    heading: "Token Exchange (RFC 8693) So the Proxy Never Holds a User Token",
    flagged: true,
    kind: "clause",
  },
  { description: "short topic label", heading: "Cache Layer", flagged: false },
  { description: "short topic label prior art", heading: "Prior Art", flagged: false },
  { description: "short topic label blast radius", heading: "Blast Radius", flagged: false },
  { description: "short topic label error taxonomy", heading: "Error Taxonomy", flagged: false },
  {
    description: "topic with parenthetical citation",
    heading: "Token Exchange (RFC 8693)",
    flagged: false,
  },
  { description: "single word size", heading: "Size", flagged: false },
  { description: "single word proposal", heading: "Proposal", flagged: false },
  { description: "imperative two words below threshold", heading: "Build Now", flagged: false },
  { description: "enumerator stage", heading: "Stage 1: Context Gathering", flagged: false },
  { description: "enumerator step", heading: "Step 1: Read the Transcript", flagged: false },
  { description: "enumerator phase", heading: "Phase: Calendar", flagged: false },
  { description: "enumerator example", heading: "Example: Blog Schema", flagged: false },
  {
    description: "enumerator pattern",
    heading: "Pattern 2: Domain-specific organization",
    flagged: false,
  },
  {
    description: "documented miss: 5 words, of-phrase, no verb",
    heading: "Blast Radius of a Leaked Key",
    flagged: false,
  },
  {
    description: "documented miss: verb-less, 4 words after stripping parenthetical",
    heading: "Machine-Readable Internal Error Taxonomy (Client vs Server Cases)",
    flagged: false,
  },
  {
    description: "documented miss: colon clause whose verb is outside the linking set",
    heading: "Refresh: Now Supported at the Edge, Unconfirmed for the Client",
    flagged: false,
  },
  {
    description: "documented miss: long verb-less noun phrase",
    heading: "Programmatic, Conformant Schema Registration Guidance for Multi-Tenant Setups",
    flagged: false,
  },
  {
    description: "long noun-phrase title with no verb",
    heading: "Architecture Review: CLI Command Package Layout",
    flagged: false,
  },
  {
    description: "ticket-prefixed task heading",
    heading: "ABC-1234: Defer eager view binding in the loader",
    flagged: false,
  },
  {
    description: "interrogative rationale label with linking verb",
    heading: "Why the Default Is Unsafe",
    flagged: false,
    kind: "interrogative",
  },
  {
    description: "interrogative section label",
    heading: "What was wrong",
    flagged: false,
    kind: "interrogative",
  },
];

describe("classifyHeadingBaseline", () => {
  for (const { description, heading, flagged, kind } of seedCases) {
    it(description, () => {
      const verdict = classifyHeadingBaseline(heading);
      expect(verdict.flagged).toBe(flagged);
      if (kind != null) {
        expect(verdict.kind).toBe(kind);
      }
    });
  }
});
