import { describe, expect, spyOn, test } from "bun:test";
import {
  byCriterion,
  aggregateVerdicts,
  CHUNK_WORD_LIMIT,
  type CriterionKey,
  chunkDocument,
  countWords,
  estimateCost,
  estimateHeadingCost,
  HEADING_BATCH_SIZE,
  HEADING_PROMPT_PATH,
  JUDGE_CRITERIA,
  JUDGE_MODEL,
  type JudgeVerdict,
  judgeCorpus,
  judgeDocument,
  judgeHeadings,
  loadPrompt,
  PROMPT_PATH,
  parseHeadingVerdicts,
  parseVerdict,
  sha256,
  verdictSchema,
} from "./judge";

function verdict(overrides: Partial<Record<CriterionKey, boolean | string>> = {}): JudgeVerdict {
  return byCriterion((key) => {
    const override = overrides[key];
    if (override === undefined) return { flagged: false, span: null };
    if (typeof override === "boolean") return { flagged: override, span: null };
    return { flagged: true, span: override };
  });
}

describe("JUDGE_CRITERIA", () => {
  test("rubric order leads with information-density and ends with press-release-structure", () => {
    const ids = JUDGE_CRITERIA.map((c) => c.id);
    expect(ids[0]).toBe("information-density");
    expect(ids[1]).toBe("motivation-presence");
    expect(ids[ids.length - 1]).toBe("press-release-structure");
  });

  test("every criterion carries layer, question, and lifecycle metadata", () => {
    for (const c of JUDGE_CRITERIA) {
      expect(c.layer).toBe("meaning");
      expect(c.question.length).toBeGreaterThan(0);
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.retire.length).toBeGreaterThan(0);
    }
  });

  test("keys are unique", () => {
    const keys = JUDGE_CRITERIA.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("prompt artifact", () => {
  test("the committed prompt documents every criterion with both example blocks", async () => {
    const prompt = await loadPrompt();
    for (const c of JUDGE_CRITERIA) {
      expect(prompt.text).toContain(`### \`${c.key}\``);
    }
    expect(prompt.text.match(/Flagged example:/g)?.length).toBe(JUDGE_CRITERIA.length);
    expect(prompt.text.match(/Neutral example:/g)?.length).toBe(JUDGE_CRITERIA.length);
  });

  test("criteria appear in the prompt in rubric order", async () => {
    const prompt = await loadPrompt();
    const positions = JUDGE_CRITERIA.map((c) => prompt.text.indexOf(`### \`${c.key}\``));
    expect(positions.toSorted((a, b) => a - b)).toEqual(positions);
  });

  test("hash is the sha256 of the file contents", async () => {
    const prompt = await loadPrompt(PROMPT_PATH);
    const raw = await Bun.file(PROMPT_PATH).text();
    expect(prompt.sha256).toBe(sha256(raw));
    expect(prompt.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("heading prompt loads and hashes", async () => {
    const prompt = await loadPrompt(HEADING_PROMPT_PATH);
    expect(prompt.text).toContain("sentence-shaped");
    expect(prompt.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verdictSchema", () => {
  test("requires every criterion and forbids extras", () => {
    const schema = verdictSchema();
    expect(schema.required).toEqual(JUDGE_CRITERIA.map((c) => c.key));
    expect(schema.additionalProperties).toBe(false);
  });
});

describe("parseVerdict", () => {
  test("parses a complete verdict", () => {
    const json = JSON.stringify(verdict({ information_density: "All 12 tests pass." }));
    const parsed = parseVerdict(json);
    expect(parsed.information_density).toEqual({
      flagged: true,
      span: "All 12 tests pass.",
    });
    expect(parsed.sycophancy).toEqual({ flagged: false, span: null });
  });

  test("rejects invalid JSON", () => {
    expect(() => parseVerdict("not json")).toThrow("invalid JSON");
  });

  test("rejects a missing criterion", () => {
    const { hedging_density: _dropped, ...partial } = verdict();
    expect(() => parseVerdict(JSON.stringify(partial))).toThrow(
      'missing criterion "hedging_density"',
    );
  });

  test.each<{ name: string; sycophancy: unknown; error: string }>([
    {
      name: "non-boolean flagged",
      sycophancy: { flagged: "yes", span: null },
      error: "must be a boolean",
    },
    {
      name: "non-string span",
      sycophancy: { flagged: true, span: 7 },
      error: "must be a string or null",
    },
    {
      name: "a non-object criterion",
      sycophancy: "flagged",
      error: 'missing criterion "sycophancy"',
    },
    { name: "a non-object verdict", sycophancy: undefined, error: "must be a JSON object" },
  ])("rejects $name", ({ name, sycophancy, error }) => {
    const json =
      name === "a non-object verdict"
        ? JSON.stringify(["not", "an", "object"])
        : JSON.stringify({ ...verdict(), sycophancy });
    expect(() => parseVerdict(json)).toThrow(error);
  });
});

describe("chunkDocument", () => {
  const paragraph = (words: number, word = "lorem") => Array(words).fill(word).join(" ");

  test("returns short documents whole", () => {
    const text = `${paragraph(10)}\n\n${paragraph(10)}`;
    expect(chunkDocument(text)).toEqual([text]);
  });

  test("splits at paragraph boundaries above the word limit", () => {
    const a = paragraph(600, "alpha");
    const b = paragraph(600, "beta");
    const c = paragraph(600, "gamma");
    const chunks = chunkDocument([a, b, c].join("\n\n"));
    expect(chunks).toEqual([`${a}\n\n${b}`, c]);
    for (const chunk of chunks) {
      expect(countWords(chunk)).toBeLessThanOrEqual(CHUNK_WORD_LIMIT);
    }
  });

  test("keeps an oversized single paragraph whole", () => {
    const huge = paragraph(CHUNK_WORD_LIMIT + 100);
    expect(chunkDocument(`${paragraph(5)}\n\n${huge}`)).toEqual([paragraph(5), huge]);
  });
});

describe("aggregateVerdicts", () => {
  test("takes per-criterion maxima across chunks", () => {
    const aggregated = aggregateVerdicts([
      verdict({ marketing_phrasing: "blazing-fast" }),
      verdict({ hedging_density: true }),
      verdict(),
    ]);
    expect(aggregated.marketing_phrasing).toEqual({ flagged: true, span: "blazing-fast" });
    expect(aggregated.hedging_density).toEqual({ flagged: true, span: null });
    expect(aggregated.information_density.flagged).toBe(false);
  });

  test("keeps the first flagged span when a later chunk also flags", () => {
    const aggregated = aggregateVerdicts([
      verdict({ sycophancy: "Great question!" }),
      verdict({ sycophancy: "Spot on!" }),
    ]);
    expect(aggregated.sycophancy.span).toBe("Great question!");
  });

  test("requires at least one verdict", () => {
    expect(() => aggregateVerdicts([])).toThrow();
  });
});

describe("judgeDocument", () => {
  test("judges each chunk and aggregates", async () => {
    const seen: string[] = [];
    const judge = (chunk: string) => {
      seen.push(chunk);
      return Promise.resolve(verdict({ information_density: seen.length === 2 }));
    };
    const long = `${Array.from({ length: 1400 }, () => "alpha").join(" ")}\n\n${Array.from({ length: 1400 }, () => "beta").join(" ")}`;
    const result = await judgeDocument(judge, long);
    expect(seen.length).toBe(2);
    expect(result.information_density.flagged).toBe(true);
  });
});

describe("estimateCost", () => {
  test("counts one call per chunk and prices by model", async () => {
    const longDoc = Array.from({ length: 3 }, () =>
      Array.from({ length: 1200 }, () => "word").join(" "),
    ).join("\n\n");
    const docs = ["short doc one", longDoc];
    const estimate = await estimateCost(docs, { promptText: "prompt words here" });
    expect(estimate.calls).toBe(4);
    expect(estimate.usd).toBeGreaterThan(0);
    expect(estimate.inputTokens).toBeGreaterThan(estimate.outputTokens);
  });

  test("an injected counter replaces the word heuristic", async () => {
    const counted: string[] = [];
    const estimate = await estimateCost(["doc one", "doc two"], {
      promptText: "prompt words here",
      countTokens: (userContent) => {
        counted.push(userContent);
        return Promise.resolve(1000);
      },
    });
    expect(counted).toEqual(["doc one", "doc two"]);
    expect(estimate.inputTokens).toBe(2000);
  });

  test("heading estimate counts one call per batch, not per heading", async () => {
    const headings = Array.from(
      { length: HEADING_BATCH_SIZE * 2 + 1 },
      () => "Deployment Topology",
    );
    const batches: string[] = [];
    const estimate = await estimateHeadingCost(headings, {
      promptText: "prompt words here",
      countTokens: (userContent) => {
        batches.push(userContent);
        return Promise.resolve(500);
      },
    });
    expect(estimate.calls).toBe(3);
    expect(batches[0]).toContain("0\tDeployment Topology");
    expect(batches[2]).toBe("0\tDeployment Topology");
  });

  test("a 200-document run of 1k-word PR bodies stays under a dollar on haiku", async () => {
    const prompt = await loadPrompt();
    const docs = Array.from({ length: 200 }, () =>
      Array.from({ length: 1000 }, () => "word").join(" "),
    );
    const estimate = await estimateCost(docs, { promptText: prompt.text });
    expect(estimate.usd).toBeLessThan(1);
  });
});

describe("modelPricing", () => {
  test.each<[string, number]>([
    ["claude-haiku-4-5", 0.0025],
    ["claude-haiku-5-20260901", 0.0025],
    ["claude-sonnet-4-6", 0.0075],
    ["claude-sonnet-5", 0.0075],
    ["claude-opus-5", 0.0125],
    ["claude-opus-5[1m]", 0.0125],
    ["claude-fable-5", 0.025],
    ["claude-mythos-5", 0.025],
  ])("prices %s from its family", async (model, usd) => {
    const estimate = await estimateCost(["doc"], {
      promptText: "prompt",
      model,
      countTokens: () => Promise.resolve(1000),
    });
    expect(estimate.usd).toBeCloseTo(usd, 6);
  });

  test("an unrecognized family falls back to haiku rates and warns", async () => {
    const warn = spyOn(console, "error").mockImplementation(() => {});
    try {
      const estimate = await estimateCost(["doc"], {
        promptText: "prompt",
        model: "some-other-vendor-model",
        countTokens: () => Promise.resolve(1000),
      });
      expect(estimate.usd).toBeCloseTo(0.0025, 6);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain("some-other-vendor-model");
    } finally {
      warn.mockRestore();
    }
  });

  test("a matched family does not warn", async () => {
    const warn = spyOn(console, "error").mockImplementation(() => {});
    try {
      await estimateCost(["doc"], {
        promptText: "prompt",
        model: JUDGE_MODEL,
        countTokens: () => Promise.resolve(1000),
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("judgeCorpus", () => {
  test("accumulates flag counts and sampled spans per criterion", async () => {
    const verdicts = [
      verdict({ information_density: "All tests pass." }),
      verdict({ information_density: "Updated three files.", sycophancy: true }),
      verdict(),
    ];
    let i = 0;
    const judge = () => Promise.resolve(verdicts[i++] ?? verdict());
    const audit = await judgeCorpus(judge, ["a", "b", "c"], {
      promptSha256: "abc123",
      model: "claude-haiku-4-5",
      estimatedCostUsd: 0.01,
    });
    const sycophancy = audit.criteria.find((c) => c.id === "sycophancy");
    expect({
      documents: audit.documents,
      promptSha256: audit.promptSha256,
      density: audit.criteria[0],
      sycophancy: sycophancy && { flagged: sycophancy.flagged, spans: sycophancy.spans },
    }).toMatchInlineSnapshot(`
      {
        "density": {
          "flagged": 2,
          "id": "information-density",
          "question": "Given that the reviewer has the diff, does this text tell them anything they could not see for themselves?",
          "spans": [
            "All tests pass.",
            "Updated three files.",
          ],
          "total": 3,
        },
        "documents": 3,
        "promptSha256": "abc123",
        "sycophancy": {
          "flagged": 1,
          "spans": [],
        },
      }
    `);
  });

  test("caps sampled spans", async () => {
    const judge = () => Promise.resolve(verdict({ marketing_phrasing: "seamless" }));
    const audit = await judgeCorpus(
      judge,
      Array.from({ length: 8 }, () => "doc"),
      {
        promptSha256: "abc",
        model: "claude-haiku-4-5",
        estimatedCostUsd: 0,
        maxSpans: 2,
      },
    );
    const marketing = audit.criteria.find((c) => c.id === "marketing-phrasing");
    expect(marketing?.flagged).toBe(8);
    expect(marketing?.spans.length).toBe(2);
  });
});

describe("parseHeadingVerdicts", () => {
  test("orders verdicts by index", () => {
    const json = JSON.stringify({
      headings: [
        { index: 1, sentence_shaped: true },
        { index: 0, sentence_shaped: false },
      ],
    });
    expect(parseHeadingVerdicts(json, 2)).toEqual([false, true]);
  });

  test("rejects incomplete coverage and out-of-range indexes", () => {
    expect(() =>
      parseHeadingVerdicts(JSON.stringify({ headings: [{ index: 0, sentence_shaped: true }] }), 2),
    ).toThrow("covered 1 of 2");
    expect(() =>
      parseHeadingVerdicts(JSON.stringify({ headings: [{ index: 5, sentence_shaped: true }] }), 2),
    ).toThrow("out of range");
  });
});

describe("judgeHeadings", () => {
  test("batches headings per call", async () => {
    const batches: number[] = [];
    const judge = (headings: string[]) => {
      batches.push(headings.length);
      return Promise.resolve(headings.map(() => false));
    };
    const verdicts = await judgeHeadings(
      judge,
      Array.from({ length: HEADING_BATCH_SIZE + 3 }, () => "Heading"),
    );
    expect(batches).toEqual([HEADING_BATCH_SIZE, 3]);
    expect(verdicts.length).toBe(HEADING_BATCH_SIZE + 3);
  });
});

describe("hook wall", () => {
  test("no hook or detection module imports the judge", async () => {
    const glob = new Bun.Glob("**/*.ts");
    const root = `${import.meta.dirname}/../../../`;
    await Promise.all(
      ["hooks", "detection", "linguistics"].map(async (dir) => {
        for await (const file of glob.scan(`${root}${dir}`)) {
          const source = await Bun.file(`${root}${dir}/${file}`).text();
          expect(source).not.toMatch(/from\s+["'][^"']*judge["']/);
          expect(source).not.toContain("@anthropic-ai/sdk");
        }
      }),
    );
  });
});
