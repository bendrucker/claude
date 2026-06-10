import { describe, expect, test } from "bun:test";
import {
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
  const v = {} as JudgeVerdict;
  for (const c of JUDGE_CRITERIA) {
    const override = overrides[c.key];
    if (override === undefined) {
      v[c.key] = { flagged: false, span: null };
    } else if (typeof override === "boolean") {
      v[c.key] = { flagged: override, span: null };
    } else {
      v[c.key] = { flagged: true, span: override };
    }
  }
  return v;
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
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
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
    const schema = verdictSchema() as { required: string[]; additionalProperties: boolean };
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
    const partial: Record<string, unknown> = JSON.parse(JSON.stringify(verdict()));
    delete partial.hedging_density;
    expect(() => parseVerdict(JSON.stringify(partial))).toThrow(
      'missing criterion "hedging_density"',
    );
  });

  test("rejects non-boolean flagged and non-string span", () => {
    const bad = JSON.parse(JSON.stringify(verdict())) as Record<
      string,
      { flagged: unknown; span: unknown }
    >;
    const sycophancy = bad.sycophancy as { flagged: unknown; span: unknown };
    sycophancy.flagged = "yes";
    expect(() => parseVerdict(JSON.stringify(bad))).toThrow("must be a boolean");
    sycophancy.flagged = true;
    sycophancy.span = 7;
    expect(() => parseVerdict(JSON.stringify(bad))).toThrow("must be a string or null");
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
    const judge = async (chunk: string) => {
      seen.push(chunk);
      return verdict({ information_density: seen.length === 2 });
    };
    const long = `${Array(1400).fill("alpha").join(" ")}\n\n${Array(1400).fill("beta").join(" ")}`;
    const result = await judgeDocument(judge, long);
    expect(seen.length).toBe(2);
    expect(result.information_density.flagged).toBe(true);
  });
});

describe("estimateCost", () => {
  test("counts one call per chunk and prices by model", async () => {
    const longDoc = Array(3).fill(Array(1200).fill("word").join(" ")).join("\n\n");
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
      countTokens: async (userContent) => {
        counted.push(userContent);
        return 1000;
      },
    });
    expect(counted).toEqual(["doc one", "doc two"]);
    expect(estimate.inputTokens).toBe(2000);
  });

  test("heading estimate counts one call per batch, not per heading", async () => {
    const headings = Array(HEADING_BATCH_SIZE * 2 + 1).fill("Deployment Topology");
    const batches: string[] = [];
    const estimate = await estimateHeadingCost(headings, {
      promptText: "prompt words here",
      countTokens: async (userContent) => {
        batches.push(userContent);
        return 500;
      },
    });
    expect(estimate.calls).toBe(3);
    expect(batches[0]).toContain("0\tDeployment Topology");
    expect(batches[2]).toBe("0\tDeployment Topology");
  });

  test("a 200-document run of 1k-word PR bodies stays under a dollar on haiku", async () => {
    const prompt = await loadPrompt();
    const docs = Array(200).fill(Array(1000).fill("word").join(" "));
    const estimate = await estimateCost(docs, { promptText: prompt.text });
    expect(estimate.usd).toBeLessThan(1);
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
    const judge = async () => verdicts[i++] as JudgeVerdict;
    const audit = await judgeCorpus(judge, ["a", "b", "c"], {
      promptSha256: "abc123",
      model: "claude-haiku-4-5",
      estimatedCostUsd: 0.01,
    });
    expect(audit.documents).toBe(3);
    expect(audit.promptSha256).toBe("abc123");
    const density = audit.criteria[0];
    expect(density?.id).toBe("information-density");
    expect(density?.flagged).toBe(2);
    expect(density?.total).toBe(3);
    expect(density?.spans).toEqual(["All tests pass.", "Updated three files."]);
    const sycophancy = audit.criteria.find((c) => c.id === "sycophancy");
    expect(sycophancy?.flagged).toBe(1);
    expect(sycophancy?.spans).toEqual([]);
  });

  test("caps sampled spans", async () => {
    const judge = async () => verdict({ marketing_phrasing: "seamless" });
    const audit = await judgeCorpus(judge, Array(8).fill("doc"), {
      promptSha256: "abc",
      model: "claude-haiku-4-5",
      estimatedCostUsd: 0,
      maxSpans: 2,
    });
    const marketing = audit.criteria.find((c) => c.id === "marketing-phrasing");
    expect(marketing?.flagged).toBe(8);
    expect(marketing?.spans?.length).toBe(2);
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
    const judge = async (headings: string[]) => {
      batches.push(headings.length);
      return headings.map(() => false);
    };
    const verdicts = await judgeHeadings(judge, Array(HEADING_BATCH_SIZE + 3).fill("Heading"));
    expect(batches).toEqual([HEADING_BATCH_SIZE, 3]);
    expect(verdicts.length).toBe(HEADING_BATCH_SIZE + 3);
  });
});

describe("hook wall", () => {
  test("no hook or detection module imports the judge", async () => {
    const glob = new Bun.Glob("**/*.ts");
    const root = `${import.meta.dirname}/../../../`;
    for (const dir of ["hooks", "detection", "linguistics"]) {
      for await (const file of glob.scan(`${root}${dir}`)) {
        const source = await Bun.file(`${root}${dir}/${file}`).text();
        expect(source).not.toMatch(/from\s+["'][^"']*judge["']/);
        expect(source).not.toContain("@anthropic-ai/sdk");
      }
    }
  });
});
