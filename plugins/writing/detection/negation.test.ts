import { describe, expect, it } from "bun:test";
import * as fc from "fast-check";
import {
  CLOSED_CLASS_GOVERNORS,
  NO_NEGATION_PATTERN,
  noNegationHits,
  noNegationSpans,
  notNegationHits,
  PREDICATION_GOVERNORS,
} from "./negation";
import { scanAll } from "./scan";

// Every sentence here is invented. None is quoted from a session or a corpus.

describe("noNegationHits", () => {
  const flag = [
    "The tooltip surface holds no controls.",
    "A classifier denial leaves no durable trace.",
    "Spaces past the ninth cost no call.",
    "We want no extra flag on the wrapper.",
    "The change adds none.",
    "The request returns nothing on a miss.",
    "Copilot-assisted commits carry no marker.",
    "The migration ran, leaving nothing for the audit.",
    "That leaves no one to answer the page.",
    "Report no findings when the queue is empty.",
    "Absolute paths need neither.",
    "The audit found no defects.",
    "The rebase made no difference.",
  ];

  const allow = [
    "The fallbacks have none.",
    "The build has no tests.",
    "There is no lock on the guard.",
    "It doesn't add anything the default lacks.",
    "The list no longer needs an entry.",
    "Draining the queue is no small thing.",
    "Nothing changes when the flag is off.",
    "The queue drains, and nothing else moves.",
    "The retry path costs practically nothing.",
    "The migration made no-op edits to the config.",
    "The retry path almost never fires, so it costs almost nothing.",
    "A null here means nothing is archived under the window.",
    "The sweep skips work nobody performs twice.",
    "The queue holds findings nothing else consumes.",
    "The runner prints why no id came back.",
    "The gap is streams versus no data at all.",
    "The rate reads no different with the rule on.",
    "A null reading means nothing ever landed.",
    "It catches disagreement no gate would notice.",
    "The agent confirmed no other instance survives the sweep.",
    "The stub declares a size no kind reached in the split.",
    "A green probe means nothing went wrong in the sweep.",
    "The trace lists a path no worker took twice.",
  ];

  it.each(flag)('flags: "%s"', (text) => {
    expect(noNegationHits(text).count).toBe(1);
  });

  it.each(allow)('allows: "%s"', (text) => {
    expect(noNegationHits(text).count).toBe(0);
  });

  it("reads a hyphenated head after no as a determiner, not as no one", () => {
    expect(noNegationHits("Losing means no one-shot path.").sample).toBe("means no one-shot");
  });

  it("counts every construction in a sentence and samples the first", () => {
    const text = "The change adds none, and the request returns nothing on a miss.";
    expect(noNegationHits(text)).toEqual({ count: 2, sample: "adds none" });
  });

  it("reports the samples in a paragraph mixing every case", () => {
    const paragraph = [
      "The tooltip surface holds no controls, and the fallbacks have none.",
      "Spaces past the ninth cost no call, so the router needs neither.",
      "Nothing changes when the flag is off, and the list no longer needs an entry.",
      "Report no findings once the audit found no defects.",
      "There is no lock on the guard, and it doesn't add anything the default lacks.",
      "The migration left nothing behind, which leaves no one to page.",
    ].join(" ");
    expect(noNegationSpans(paragraph).map((span) => span.matched)).toMatchSnapshot();
  });

  it("reports one scan result per construction", () => {
    const text = "The wrapper adds nothing, holds no controls, and leaves no one to page.";
    const categories = scanAll(text, "notes.md").map((result) => result.category);
    expect(categories.filter((category) => category === "no-negation")).toHaveLength(3);
  });

  it("never flags an excluded governing word", () => {
    const governors = [...CLOSED_CLASS_GOVERNORS, ...PREDICATION_GOVERNORS].filter((word) =>
      /^[a-z]+$/.test(word),
    );
    fc.assert(
      fc.property(
        fc.constantFrom(...governors),
        fc.constantFrom("no", "none", "nothing", "nobody", "nowhere", "neither", "no one"),
        fc.constantFrom("controls", "trace", "flag", "entry", "call"),
        (governor, indefinite, head) => {
          expect(noNegationHits(`The router ${governor} ${indefinite} ${head}.`).count).toBe(0);
        },
      ),
    );
  });
});

describe("notNegationHits", () => {
  const flag = [
    "It doesn't add anything the default lacks.",
    "The guard does not hold any lock.",
    "The router never pages anyone on a retry.",
    "The worker cannot write anywhere outside the queue.",
    "The change does not touch either path.",
    "It doesn't, however, add anything the default lacks.",
    "The worker cannot read or write anything outside the queue.",
    "The guard does not and never will hold any lock.",
  ];

  const allow = [
    "The wrapper adds nothing to the default path.",
    "The guard is not held during the retry.",
    "Anything the parser rejects lands in the queue.",
    "The audit never ran.",
    "It does not matter which worker drains the queue first, as long as any one of them does.",
    "It does not apply, but anyone can run it.",
    "The guard is not held (anything else drains first).",
    "It doesn't apply but anyone can run it.",
    "It is not clear whether anyone will run it.",
  ];

  it.each(flag)('flags: "%s"', (text) => {
    expect(notNegationHits(text).count).toBe(1);
  });

  it.each(allow)('allows: "%s"', (text) => {
    expect(notNegationHits(text).count).toBe(0);
  });
});

describe("NO_NEGATION_PATTERN", () => {
  it("asks for the positive term ahead of verb negation", () => {
    const message = NO_NEGATION_PATTERN.message("holds no controls");
    expect(message).toContain("holds no controls");
    expect(message.indexOf("a no-op")).toBeLessThan(message.indexOf("verb negation"));
  });
});
