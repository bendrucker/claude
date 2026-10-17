import { beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { rebuildViews, runQuery } from "./db";
import {
  db,
  filterParams,
  fixturesDir,
  importsDir,
  loadExtensions,
  plansFixtureDir,
  reindex,
  tmpDir,
  useFixtureIndex,
} from "./db.fixture";

useFixtureIndex();

describe("source_line", () => {
  it("numbers ingested rows 1..N per file", async () => {
    const rows = await db.query(
      `SELECT source_file, COUNT(*) AS n, MIN(source_line) AS lo,
              MAX(source_line) AS hi, COUNT(DISTINCT source_line) AS d
       FROM raw WHERE host = 'local' GROUP BY source_file`,
      z.object({
        source_file: z.string(),
        n: z.bigint(),
        lo: z.bigint(),
        hi: z.bigint(),
        d: z.bigint(),
      }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Number(row.lo)).toBe(1);
      expect(Number(row.hi)).toBe(Number(row.n));
      expect(Number(row.d)).toBe(Number(row.n));
    }
  });
});

describe("attribution and skill-activity query", () => {
  it("exposes attribution on tool_calls", async () => {
    const [row] = await db.query(
      "SELECT attribution_skill FROM tool_calls WHERE tool_id = 'hk-write-1'",
      z.object({ attribution_skill: z.string() }),
    );
    expect(row?.attribution_skill).toBe("writing:writing");
  });

  it("aggregates attributed work and tokens per skill", async () => {
    const rows = await runQuery(
      db,
      "skill-activity",
      z.object({ skill: z.string(), assistant_turns: z.bigint() }),
      filterParams(),
    );
    const writing = rows.find((r) => r.skill === "writing:writing");
    expect(Number(writing?.assistant_turns)).toBeGreaterThanOrEqual(1);
  });
});

describe("skill-auto-vs-explicit query", () => {
  const Split = z.object({
    skill_name: z.string(),
    model_auto: z.bigint(),
    chained: z.bigint(),
    explicit: z.bigint(),
    total: z.bigint(),
  });
  type Split = z.infer<typeof Split>;

  it("counts a Skill call carrying args as model routing, not an explicit invocation", async () => {
    const rows = await runQuery(
      db,
      "skill-auto-vs-explicit",
      Split,
      filterParams({ min_calls: null }),
    );
    const peer = rows.find((r) => r.skill_name === "review:peer");
    // Both review:peer calls pass args and neither was typed as a slash command.
    expect(Number(peer?.model_auto)).toBe(2);
    expect(Number(peer?.chained)).toBe(0);
  });

  it("counts a typed slash command as explicit and a skill-attributed call as chained", async () => {
    const rows = await runQuery(
      db,
      "skill-auto-vs-explicit",
      Split,
      filterParams({ min_calls: null }),
    );
    const peer = rows.find((r) => r.skill_name === "review:peer");
    expect(Number(peer?.explicit)).toBe(1);
    const create = rows.find((r) => r.skill_name === "pull-request:create");
    expect(Number(create?.model_auto)).toBe(1);
    expect(Number(create?.chained)).toBe(1);
    expect(Number(create?.explicit)).toBe(0);
  });

  it("credits a bare command to an unnamespaced skill, not a namespaced sibling", async () => {
    const rows = await runQuery(
      db,
      "skill-auto-vs-explicit",
      Split,
      filterParams({ min_calls: null }),
    );
    const solo = rows.find((r) => r.skill_name === "solo");
    expect(Number(solo?.explicit)).toBe(1);
    expect(Number(solo?.total)).toBe(2);
    // A bare `/peer` cannot invoke `review:peer`, so only the namespaced marker counts.
    const peer = rows.find((r) => r.skill_name === "review:peer");
    expect(Number(peer?.explicit)).toBe(1);
  });
});

describe("plan_calls view and plans query", () => {
  it("classifies a redirected plan as outcome=redirected with plan_seq=1", async () => {
    const rows = await db.query(
      "SELECT session_id, outcome, plan_seq, plan_chars, plan_file FROM plan_calls WHERE session_id = 'plan-session' ORDER BY plan_seq",
      z.object({
        session_id: z.string(),
        outcome: z.string(),
        plan_seq: z.bigint(),
        plan_chars: z.bigint(),
        plan_file: z.string(),
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.outcome).toBe("redirected");
    expect(Number(rows[0]?.plan_seq)).toBe(1);
    expect(Number(rows[0]?.plan_chars)).toBeGreaterThan(0);
    expect(rows[0]?.plan_file).toContain("plan-session");
  });

  it("classifies the second plan (after approval) as outcome=approved with plan_seq=2", async () => {
    const rows = await db.query(
      "SELECT outcome, plan_seq FROM plan_calls WHERE session_id = 'plan-session' ORDER BY plan_seq",
      z.object({ outcome: z.string(), plan_seq: z.bigint() }),
    );
    expect(rows[1]?.outcome).toBe("approved");
    expect(Number(rows[1]?.plan_seq)).toBe(2);
  });

  it("aggregates plan_sessions with correct counts and replan tier", async () => {
    const [row] = await db.query(
      "SELECT plan_count, redirect_count, approved_count FROM plan_sessions WHERE session_id = 'plan-session'",
      z.object({ plan_count: z.bigint(), redirect_count: z.bigint(), approved_count: z.bigint() }),
    );
    expect(Number(row?.plan_count)).toBe(2);
    expect(Number(row?.redirect_count)).toBe(1);
    expect(Number(row?.approved_count)).toBe(1);
  });

  it("reports the session via the plans query with replan_tier=replan", async () => {
    const rows = await runQuery(
      db,
      "plans",
      z.object({ session_id: z.string(), replan_tier: z.string(), plan_count: z.bigint() }),
      { after_date: null, before_date: null, project: null, host: null, min_plans: null },
    );
    const row = rows.find((r) => r.session_id === "plan-session");
    expect(row).toBeDefined();
    expect(row?.replan_tier).toBe("replan");
    expect(Number(row?.plan_count)).toBe(2);
  });

  it("excludes sessions below min_plans threshold", async () => {
    const rows = await runQuery(db, "plans", z.object({ session_id: z.string() }), {
      after_date: null,
      before_date: null,
      project: null,
      host: null,
      min_plans: "3",
    });
    expect(rows.find((r) => r.session_id === "plan-session")).toBeUndefined();
  });

  it("classifies a terminal rejection with no edits after as outcome=handoff", async () => {
    // handoff-session ends on a rejected plan followed only by a Read, the
    // reject-and-handoff workflow (implement from the plan file in a fresh session).
    const rows = await db.query(
      "SELECT outcome FROM plan_calls WHERE session_id = 'handoff-session'",
      z.object({ outcome: z.string() }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("handoff");
  });

  it("classifies the 'approved exiting plan mode' wording as outcome=approved", async () => {
    // The harness has shipped more than one approval string. Matching only "approved
    // your plan" dropped this one into 'unknown', which reads as a plan the user never
    // approved. A new wording should fail here rather than silently misclassify.
    const rows = await db.query(
      "SELECT outcome FROM plan_calls WHERE session_id = 'plan-approve-variant-session'",
      z.object({ outcome: z.string() }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("approved");
  });

  it("keeps a terminal rejection followed by file edits as outcome=redirected", async () => {
    const rows = await db.query(
      "SELECT outcome FROM plan_calls WHERE session_id = 'plan-abandon-session'",
      z.object({ outcome: z.string() }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("redirected");
  });

  it("counts handoffs separately from redirects in plan_sessions", async () => {
    const [row] = await db.query(
      "SELECT redirect_count, handoff_count FROM plan_sessions WHERE session_id = 'handoff-session'",
      z.object({ redirect_count: z.bigint(), handoff_count: z.bigint() }),
    );
    expect(Number(row?.redirect_count)).toBe(0);
    expect(Number(row?.handoff_count)).toBe(1);
  });

  it("tiers a handoff-only session as single, keyed on mid-session redirects", async () => {
    const rows = await runQuery(
      db,
      "plans",
      z.object({ session_id: z.string(), replan_tier: z.string(), handoff_count: z.bigint() }),
      { after_date: null, before_date: null, project: null, host: null, min_plans: null },
    );
    const handoff = rows.find((r) => r.session_id === "handoff-session");
    expect(handoff?.replan_tier).toBe("single");
    expect(Number(handoff?.handoff_count)).toBe(1);
  });
});

describe("plan-iterations query", () => {
  // plan-iterations-session presents three plans: A,B,C (rejected) -> A,B,C,D,E
  // (rejected, append-only) -> A,D,F (approved, a real prune). Exercises growth,
  // carry-over, and removal in the same session.
  const PlanIterationRow = z.object({
    sid: z.string(),
    plan_seq: z.bigint(),
    outcome: z.string(),
    lines_added: z.bigint().nullable(),
    lines_removed: z.bigint().nullable(),
    lines_carried: z.bigint().nullable(),
    carry_over_ratio: z.number().nullable(),
    secs_since_prev: z.bigint().nullable(),
    secs_to_first_plan: z.bigint().nullable(),
    human_msgs: z.bigint(),
  });
  type PlanIterationRow = z.infer<typeof PlanIterationRow>;

  async function planIterationRows() {
    const rows = await runQuery(db, "plan-iterations", PlanIterationRow, {
      after_date: null,
      before_date: null,
      project: null,
      host: null,
      min_plans: "1",
    });
    return rows
      .filter((r) => r.sid === "plan-ite")
      .toSorted((a, b) => Number(a.plan_seq) - Number(b.plan_seq));
  }

  it("leaves growth/removal/carry-over and secs_since_prev null on the first present", async () => {
    const rows = await planIterationRows();
    expect(rows).toHaveLength(3);
    const first = rows[0];
    expect(first?.outcome).toBe("redirected");
    expect(first?.lines_added).toBeNull();
    expect(first?.lines_removed).toBeNull();
    expect(first?.lines_carried).toBeNull();
    expect(first?.carry_over_ratio).toBeNull();
    expect(first?.secs_since_prev).toBeNull();
  });

  it("measures append-only growth on the second present: added 2, removed 0, carried 3, ratio 0.60", async () => {
    const rows = await planIterationRows();
    const second = rows[1];
    expect(second?.outcome).toBe("redirected");
    expect(Number(second?.lines_added)).toBe(2);
    expect(Number(second?.lines_removed)).toBe(0);
    expect(Number(second?.lines_carried)).toBe(3);
    expect(second?.carry_over_ratio).toBe(0.6);
    expect(Number(second?.secs_since_prev)).toBe(300);
  });

  it("measures a real prune on the third present: added 1, removed 3, carried 2", async () => {
    const rows = await planIterationRows();
    const third = rows[2];
    expect(third?.outcome).toBe("approved");
    expect(Number(third?.lines_added)).toBe(1);
    expect(Number(third?.lines_removed)).toBe(3);
    expect(Number(third?.lines_carried)).toBe(2);
    expect(Number(third?.secs_since_prev)).toBe(300);
  });

  it("reports secs_to_first_plan from the plan-mode record and human_msgs from last-prompt records, repeated on every row", async () => {
    const rows = await planIterationRows();
    for (const row of rows) {
      expect(Number(row.secs_to_first_plan)).toBe(300);
      expect(Number(row.human_msgs)).toBe(2);
    }
  });

  it("excludes sessions below min_plans threshold", async () => {
    const rows = await runQuery(db, "plan-iterations", PlanIterationRow, {
      after_date: null,
      before_date: null,
      project: null,
      host: null,
      min_plans: "4",
    });
    expect(rows.find((r) => r.sid === "plan-ite")).toBeUndefined();
  });
});

describe("replayed line dedupe", () => {
  // replay.jsonl duplicates its tool_use, tool_result, and hook attachment lines
  // verbatim (same uuid) further down the file, the rewind/resume replay shape.
  it("keeps one content_items row per replayed tool_use and tool_result", async () => {
    const uses = await db.query(
      "SELECT COUNT(*) AS n FROM content_items WHERE type = 'tool_use' AND id = 'rp-tool-1'",
      z.object({ n: z.bigint() }),
    );
    expect(Number(uses[0]?.n)).toBe(1);
    const results = await db.query(
      "SELECT COUNT(*) AS n FROM content_items WHERE type = 'tool_result' AND tool_use_id = 'rp-tool-1'",
      z.object({ n: z.bigint() }),
    );
    expect(Number(results[0]?.n)).toBe(1);
  });

  it("keeps one tool_calls row per replayed tool_use", async () => {
    const rows = await db.query(
      "SELECT COUNT(*) AS n FROM tool_calls WHERE tool_id = 'rp-tool-1'",
      z.object({ n: z.bigint() }),
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it("keeps one hook_events row per replayed hook attachment", async () => {
    const rows = await db.query(
      "SELECT COUNT(*) AS n FROM hook_events WHERE session_id = 'replay-session' AND kind = 'hook_blocking_error'",
      z.object({ n: z.bigint() }),
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});

describe("stop-hook-noop-detector query", () => {
  const NoopRow = z.object({
    command: z.string(),
    fires: z.bigint(),
    total_ms: z.bigint(),
    events: z.bigint(),
    with_stdout: z.bigint(),
    with_decision: z.bigint(),
    nonzero_exit: z.bigint(),
    blocks: z.bigint(),
    gated_stops: z.bigint(),
  });

  async function detect() {
    const rows = await runQuery(db, "stop-hook-noop-detector", NoopRow, filterParams());
    return new Map(rows.map((r) => [r.command, r]));
  }

  it("surfaces a hook that fires and writes nothing to the attachment channel", async () => {
    // oxlint-disable-next-line no-template-curly-in-string -- the fixture records the hook command unexpanded, so the key must match it.
    const silent = (await detect()).get("bun ${CLAUDE_PLUGIN_ROOT}/hooks/silent-stop.ts");
    expect(silent).toBeDefined();
    expect(Number(silent?.fires)).toBe(2);
    expect(Number(silent?.total_ms)).toBe(82);
    expect(Number(silent?.events)).toBe(0);
    expect(Number(silent?.with_stdout)).toBe(0);
    expect(Number(silent?.blocks)).toBe(0);
  });

  it("pairs a rostered hook with the attachments it wrote", async () => {
    const test = (await detect()).get("make test-unit");
    expect(Number(test?.fires)).toBe(1);
    expect(Number(test?.events)).toBe(1);
  });

  it("counts blocking errors so a Stop gate is not a noop candidate", async () => {
    // A blocking error predating the payload's command groups under the bare hook name,
    // and the roster names the hook that ran rather than the event, so it matches no fires.
    const gate = (await detect()).get("Stop");
    expect(gate).toBeDefined();
    expect(Number(gate?.fires)).toBe(0);
    expect(Number(gate?.blocks)).toBe(Number(gate?.events));
    expect(Number(gate?.blocks)).toBeGreaterThan(0);
  });

  it("attributes a Stop block to the hook named inside its blockingError payload", async () => {
    // oxlint-disable-next-line no-template-curly-in-string -- the fixture records the hook command unexpanded, so the key must match it.
    const gate = (await detect()).get("bun ${CLAUDE_PLUGIN_ROOT}/hooks/density.ts");
    expect(gate).toBeDefined();
    expect(Number(gate?.fires)).toBe(1);
    expect(Number(gate?.blocks)).toBe(1);
  });

  it("marks the hooks that ran at a gated Stop, since the gate names no command", async () => {
    const rows = await detect();
    // Both rostered hooks share the blocked Stop's toolUseID. `silent-stop` also fires at
    // an ungated Stop, so a silent hook that may be the gate is distinguishable from one
    // that never ran at a blocked Stop.
    // oxlint-disable-next-line no-template-curly-in-string -- the fixture records the hook command unexpanded, so the key must match it.
    expect(Number(rows.get("bun ${CLAUDE_PLUGIN_ROOT}/hooks/silent-stop.ts")?.gated_stops)).toBe(1);
    expect(Number(rows.get("make test-unit")?.gated_stops)).toBe(1);
  });

  it("excludes a queued prompt the harness re-injected at Stop", async () => {
    expect((await detect()).has("monitor CI until it goes green")).toBe(false);
  });
});

describe("plan-sections query", () => {
  const plansGlob = join(plansFixtureDir, "*.md");
  const featurePlan = join(plansFixtureDir, "feature-plan.md");

  const Section = z.object({
    session_id: z.string().nullable(),
    outcome: z.string().nullable(),
    title: z.string(),
    level: z.number(),
    file_path: z.string(),
  });
  type Section = z.infer<typeof Section>;

  beforeEach(async () => {
    await loadExtensions(db);
  });

  async function insertDiskPlan() {
    // A plan_calls row whose planFilePath points at an on-disk fixture, so its
    // sections join to session context. content_items rebuilds from raw on rebuildViews.
    const assistant = JSON.stringify({
      type: "assistant",
      sessionId: "disk-plan-session",
      cwd: "/Users/test/project",
      timestamp: "2026-02-01T10:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "disk-plan-1",
            name: "ExitPlanMode",
            input: { plan: "# Feature Plan", planFilePath: featurePlan },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    });
    const result = JSON.stringify({
      type: "user",
      sessionId: "disk-plan-session",
      timestamp: "2026-02-01T10:01:00.000Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "disk-plan-1",
            content: "User has approved your plan. You can now start coding.",
          },
        ],
      },
    });
    for (const [type, line, ts] of [
      ["assistant", assistant, "2026-02-01T10:00:00"],
      ["user", result, "2026-02-01T10:01:00"],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- rows insert in fixture order on one connection so the assertions see a fixed layout.
      await db.run(
        `INSERT INTO raw (host, session_id, type, project_path, timestamp, data)
         VALUES ('local', 'disk-plan-session', $type, '/Users/test/project',
                 $ts::TIMESTAMP, $line::JSON)`,
        { type, ts, line },
      );
    }
    await rebuildViews(db);
  }

  it("parses one row per section with level and title", async () => {
    const rows = await runQuery(db, "plan-sections", Section, { plans_glob: plansGlob });
    const feature = rows.filter((r) => r.file_path === featurePlan);
    expect(feature.map((r) => r.title)).toEqual([
      "Feature Plan",
      "Context",
      "Plan",
      "Queue Sizing",
      "Verification",
    ]);
    expect(feature.find((r) => r.title === "Queue Sizing")?.level).toBe(3);
  });

  it("finds plans whose sections lack a Verification heading", async () => {
    const rows = await runQuery(db, "plan-sections", Section, { plans_glob: plansGlob });
    const byFile = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!byFile.has(r.file_path)) byFile.set(r.file_path, new Set());
      byFile.get(r.file_path)!.add(r.title);
    }
    const missing = [...byFile.entries()]
      .filter(([, titles]) => !titles.has("Verification"))
      .map(([file]) => file);
    expect(missing).toContain(join(plansFixtureDir, "quick-plan.md"));
    expect(missing).not.toContain(featurePlan);
  });

  it("joins sections to the session that produced the plan", async () => {
    await insertDiskPlan();
    const rows = await runQuery(db, "plan-sections", Section, { plans_glob: plansGlob });

    const feature = rows.filter((r) => r.file_path === featurePlan);
    expect(feature.length).toBeGreaterThan(0);
    for (const r of feature) {
      expect(r.session_id).toBe("disk-plan-session");
      expect(r.outcome).toBe("approved");
    }

    // quick-plan.md has no matching plan_calls row, so the LEFT JOIN leaves it null.
    const quick = rows.filter((r) => r.file_path === join(plansFixtureDir, "quick-plan.md"));
    expect(quick.length).toBeGreaterThan(0);
    for (const r of quick) expect(r.session_id).toBeNull();
  });

  it("omits a plan whose planFilePath does not exist on disk (cross-host/deleted)", async () => {
    // The plan-session fixture's planFilePath is /Users/test/.claude/plans/plan-session.md,
    // outside the glob. The LEFT JOIN from sections means that plan yields no section rows.
    const rows = await runQuery(db, "plan-sections", Section, { plans_glob: plansGlob });
    expect(rows.some((r) => r.session_id === "plan-session")).toBe(false);
  });
});

describe("skill-config-vs-observed query", () => {
  const skillsFixtureDir = join(import.meta.dirname, "..", "fixtures", "skills");

  const SkillRow = z.object({
    source: z.string(),
    skill_name: z.string(),
    description_chars: z.bigint(),
    disable_model_invocation: z.boolean(),
    calls: z.bigint(),
    sessions: z.bigint(),
    last_seen: z.date().nullable(),
    typed: z.bigint(),
  });
  type SkillRow = z.infer<typeof SkillRow>;

  beforeEach(async () => {
    await loadExtensions(db);
  });

  async function skillRows(overrides: Record<string, string | null> = {}) {
    return runQuery(
      db,
      "skill-config-vs-observed",
      SkillRow,
      filterParams({
        skill: null,
        plugin_skill_glob: join(skillsFixtureDir, "cache/*/*/*/skills/*/SKILL.md"),
        user_skill_glob: join(skillsFixtureDir, "user/*/SKILL.md"),
        project_skill_glob: join(skillsFixtureDir, "project/*/SKILL.md"),
        ...overrides,
      }),
    );
  }

  it("counts observed calls for a plugin skill, pinning one cache copy", async () => {
    const rows = await skillRows();
    const peer = rows.filter((r) => r.skill_name === "review:peer");
    expect(peer).toHaveLength(1);
    expect(peer[0]?.source).toBe("plugin:test-marketplace/review");
    expect(Number(peer[0]?.calls)).toBe(2);
    expect(Number(peer[0]?.sessions)).toBe(1);
    expect(peer[0]?.last_seen).not.toBeNull();
  });

  it("counts a typed slash command for a skill the model never loads", async () => {
    const rows = await skillRows();
    const typedOnly = rows.find((r) => r.skill_name === "typed-only");
    expect(Number(typedOnly?.calls)).toBe(0);
    expect(Number(typedOnly?.typed)).toBe(1);
    expect(typedOnly?.disable_model_invocation).toBe(true);
  });

  it("counts a typed slash command alongside observed calls without inflating them", async () => {
    const rows = await skillRows();
    const peer = rows.find((r) => r.skill_name === "review:peer");
    // A bare `/peer` is also in the fixture and must not land here: pre-aggregating typed
    // counts keeps them off the observed join, which would otherwise multiply calls.
    expect(Number(peer?.typed)).toBe(1);
    expect(Number(peer?.calls)).toBe(2);
  });

  it("credits a bare typed command to the entry skill it can invoke", async () => {
    const rows = await skillRows();
    const solo = rows.find((r) => r.skill_name === "solo:solo");
    expect(Number(solo?.typed)).toBe(1);
    expect(Number(solo?.calls)).toBe(1);
  });

  it("reports zero typed for a skill that is never called and never typed", async () => {
    const rows = await skillRows();
    const never = rows.find((r) => r.skill_name === "never-used");
    expect(Number(never?.calls)).toBe(0);
    expect(Number(never?.typed)).toBe(0);
  });

  it("counts a name at the full length budget, once across a replayed line", async () => {
    const rows = await skillRows();
    const long = rows.find((r) => r.skill_name.length === 64);
    expect(long).toBeDefined();
    expect(Number(long?.typed)).toBe(1);
  });

  it("ignores a marker quoted in prose or dumped into a tool result", async () => {
    const rows = await skillRows();
    const typedOnly = rows.find((r) => r.skill_name === "typed-only");
    // The fixture quotes `/typed-only` twice more, mid-sentence and inside a tool result.
    expect(Number(typedOnly?.typed)).toBe(1);
  });

  it("lets a personal skill shadow a plugin entry skill of the same name", async () => {
    const rows = await skillRows();
    const personal = rows.find((r) => r.skill_name === "twin" && r.source.startsWith("user:"));
    expect(Number(personal?.calls)).toBe(1);
    expect(Number(personal?.typed)).toBe(1);
    // The plugin's copy answers to `twin:twin` alone, so the bare call and command are
    // the personal skill's and must not be counted twice.
    const plugin = rows.find((r) => r.skill_name === "twin:twin");
    expect(Number(plugin?.calls)).toBe(0);
    expect(Number(plugin?.typed)).toBe(0);
  });

  it("matches bare observed calls to an entry skill (plugin = skill)", async () => {
    const rows = await skillRows();
    const solo = rows.find((r) => r.skill_name === "solo:solo");
    expect(Number(solo?.calls)).toBe(1);
  });

  it("sorts zero-fire skills first across all three sources", async () => {
    const rows = await skillRows();
    const zero = rows.filter((r) => Number(r.calls) === 0).map((r) => r.skill_name);
    expect(
      ["review:inbox", "never-used", "scratch"].filter((name) => !zero.includes(name)),
    ).toEqual([]);
    expect(rows.slice(0, zero.length).every((r) => Number(r.calls) === 0)).toBe(true);

    const never = rows.find((r) => r.skill_name === "never-used");
    expect(never?.source).toBe("user:~/.claude/skills");
    expect(never?.disable_model_invocation).toBe(true);
    expect(never?.last_seen).toBeNull();
    expect(Number(never?.sessions)).toBe(0);
    expect(Number(never?.description_chars)).toBeGreaterThan(0);
  });

  it("filters configured names by skill glob", async () => {
    const rows = await skillRows({ skill: "review:*" });
    expect(rows.map((r) => r.skill_name).toSorted()).toEqual(["review:inbox", "review:peer"]);
  });
});

describe("index-health query", () => {
  const projectsGlob = join(fixturesDir, "**", "*.jsonl");

  const Health = z.object({
    check_name: z.string(),
    status: z.string(),
    subject: z.string(),
    detail: z.string(),
  });
  type Health = z.infer<typeof Health>;

  function healthParams(overrides: Record<string, string | null> = {}) {
    return {
      projects_glob: projectsGlob,
      min_active_days: null,
      new_days: null,
      stale_days: null,
      deny_window_days: null,
      ...overrides,
    };
  }

  it("alerts when recovered hook denies outnumber the denies hook_events recorded", async () => {
    // A window wide enough to cover the whole fixture corpus, so the check reads the
    // same rows regardless of when the newest fixture record is dated.
    const rows = await runQuery(
      db,
      "index-health",
      Health,
      healthParams({ deny_window_days: "100000" }),
    );
    const deny = rows.find((r) => r.check_name === "hook-deny-invisible");
    expect(deny?.status).toBe("alert");
    expect(deny?.subject).toBe("7 denies recovered");
    expect(deny?.detail).toContain("git:block-default-branch-commit (5)");
    expect(deny?.detail).toContain("user:worktree (1)");
    // Recovered via the harness's PreToolUse:<Tool> hook error: prefix (hk-deny-3).
    expect(deny?.detail).toContain("pull-request:validate-body (1)");
    // Subagent denies stay in the count (hook_events misses them too) but are broken
    // out, so a reader knows the total is not all main-thread friction.
    expect(deny?.detail).toContain("3 of the recovered denies were a subagent");
  });

  it("flags a kind that went silent beyond its own historical gap", async () => {
    const rows = await runQuery(db, "index-health", Health, healthParams());
    const silent = rows.filter((r) => r.check_name === "stream-silent");
    expect(silent.map((r) => r.subject)).toEqual(["attachment:health-quiet"]);
    expect(silent[0]?.status).toBe("alert");
    expect(silent[0]?.detail).toContain("worst historical gap 1");
  });

  it("classifies a silent kind with a live successor field as migrated, not dead", async () => {
    const rows = await runQuery(db, "index-health", Health, healthParams());
    const migrated = rows.filter((r) => r.check_name === "stream-migrated");
    expect(migrated.map((r) => r.subject)).toEqual(["system:api_error"]);
    expect(migrated[0]?.status).toBe("info");
    expect(migrated[0]?.detail).toContain("isApiErrorMessage");
    expect(migrated[0]?.detail).toContain("still arriving");
  });

  it("reports a kind first seen late in the corpus as new, not kinds as old as the index", async () => {
    const rows = await runQuery(db, "index-health", Health, healthParams());
    const fresh = rows.filter((r) => r.check_name === "stream-new");
    expect(fresh.map((r) => r.subject)).toEqual(["attachment:health-fresh"]);
    expect(fresh[0]?.status).toBe("info");
  });

  it("summarizes kinds whose rows carry no timestamp", async () => {
    const rows = await runQuery(db, "index-health", Health, healthParams());
    const nullTs = rows.find((r) => r.check_name === "null-timestamp-kinds");
    expect(nullTs?.status).toBe("info");
    // The detail names only the largest kinds, so assert its shape rather than a
    // ranking any new timestamp-less fixture would reshuffle.
    expect(nullTs?.detail).toMatch(/^\d+ rows carry no timestamp .* largest: [\w-]+ \(\d+\)/);
  });

  it("reports the corpus window per host and no disk gap when the glob matches", async () => {
    const rows = await runQuery(db, "index-health", Health, healthParams());
    const windows = rows.filter((r) => r.check_name === "corpus-window");
    expect(windows.map((r) => r.subject)).toEqual(["local"]);
    expect(rows.some((r) => r.check_name === "disk-not-indexed")).toBe(false);
    expect(rows.some((r) => r.check_name === "indexed-not-on-disk")).toBe(false);
  });

  it("alerts on disk files missing from the index", async () => {
    const extraDir = join(tmpDir, "extra-projects", "-Users-test-extra");
    mkdirSync(extraDir, { recursive: true });
    await Bun.write(
      join(extraDir, "unindexed.jsonl"),
      '{"type":"user","message":{"role":"user","content":"hi"},"sessionId":"extra","timestamp":"2024-02-01T00:00:00.000Z","uuid":"ex-1"}\n',
    );
    const rows = await runQuery(
      db,
      "index-health",
      Health,
      healthParams({ projects_glob: join(tmpDir, "extra-projects", "**", "*.jsonl") }),
    );
    const missing = rows.find((r) => r.check_name === "disk-not-indexed");
    expect(missing?.status).toBe("alert");
    expect(missing?.subject).toBe("1 files");
    expect(missing?.detail).toContain("unindexed.jsonl");
    // With the glob pointed away from the fixtures, every indexed file reads as deleted.
    expect(rows.find((r) => r.check_name === "indexed-not-on-disk")?.status).toBe("info");
  });

  it("alerts on an imported host whose newest record lags the corpus", async () => {
    const staleProjects = join(importsDir, "stale", "projects", "-Users-test-stale");
    mkdirSync(staleProjects, { recursive: true });
    await Bun.write(
      join(staleProjects, "old.jsonl"),
      '{"type":"user","message":{"role":"user","content":"old work"},"sessionId":"stale-session","timestamp":"2023-12-01T00:00:00.000Z","uuid":"st-1"}\n',
    );
    await Bun.write(
      join(importsDir, "stale", "manifest.json"),
      `${JSON.stringify({
        host: "stale",
        source: "stale:.claude/projects/",
        imported_at: "2024-01-01T00:00:00Z",
        policy: { block_egress: true },
      })}\n`,
    );
    await reindex();
    const rows = await runQuery(db, "index-health", Health, healthParams());
    const staleness = rows.filter((r) => r.check_name === "host-staleness");
    // exactly the imported host: local never alerts, its remediation (re-sync)
    // does not apply
    expect(staleness.map((r) => r.subject)).toEqual(["stale"]);
    expect(staleness[0]?.status).toBe("alert");
    expect(staleness[0]?.detail).toContain("days behind the corpus");
  });
});

describe("frontmatter query", () => {
  it("parses name and description from a SKILL.md frontmatter", async () => {
    await loadExtensions(db);
    const skill = join(import.meta.dirname, "..", "SKILL.md");
    const rows = await runQuery(
      db,
      "frontmatter",
      z.object({ file_path: z.string(), name: z.string(), description: z.string() }),
      { frontmatter_glob: skill },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("observability:session");
    expect(rows[0]?.description).toContain("DuckDB index");
  });
});

describe("cost-rate macros", () => {
  it.each<[string, number, number]>([
    ["claude-fable-5", 10, 50],
    ["claude-mythos-1", 10, 50],
    ["claude-opus-5", 5, 25],
    ["claude-opus-5[1m]", 5, 25],
    ["claude-opus-4-8", 5, 25],
    ["claude-sonnet-5", 3, 15],
    ["claude-haiku-4", 1, 5],
    ["claude-haiku-4-5", 1, 5],
    ["claude-haiku-5-5", 0.1, 0.5],
    ["claude-opus-5-5", 4, 20],
    ["claude-opus-5-5[1m]", 4, 20],
    ["claude-sonnet-5-5", 2, 10],
    ["some-unknown-model", 5, 25],
  ])("rates %s at input %d / output %d per MTok", async (model, input, output) => {
    const [row] = await db.query(
      "SELECT model_input_rate($m) AS i, model_output_rate($m) AS o",
      z.object({ i: z.number(), o: z.number() }),
      { m: model },
    );
    expect(Number(row?.i)).toBe(input);
    expect(Number(row?.o)).toBe(output);
  });
});

describe("model_family macro", () => {
  it.each<[string, string]>([
    ["claude-fable-5", "fable"],
    ["claude-mythos-1", "fable"],
    ["claude-opus-5", "opus"],
    ["claude-opus-5[1m]", "opus"],
    ["claude-opus-4-8", "opus"],
    ["opus", "opus"],
    ["claude-sonnet-5", "sonnet"],
    ["claude-haiku-4", "haiku"],
    ["claude-haiku-5-5", "haiku"],
    ["claude-opus-5-5", "opus"],
    ["claude-sonnet-5-5", "sonnet"],
    ["some-unknown-model", "other"],
  ])("collapses %s to %s", async (model, family) => {
    const [row] = await db.query("SELECT model_family($m) AS f", z.object({ f: z.string() }), {
      m: model,
    });
    expect(row?.f).toBe(family);
  });

  it("returns NULL for a NULL model", async () => {
    const [row] = await db.query(
      "SELECT model_family(NULL) AS f",
      z.object({ f: z.string().nullable() }),
    );
    expect(row?.f).toBeNull();
  });
});

describe("message_usage cost columns and usage queries", () => {
  const OPUS = "claude-opus-4-8";

  // One assistant message with known usage. The cost math the queries apply:
  // input*in_rate + cache_5m*1.25*in + cache_1h*2*in + cache_read*0.1*in + output*out_rate,
  // all per MTok. For opus (in 5, out 25) with the values below that is
  // (1000*5 + 2000*1.25*5 + 3000*2*5 + 10000*0.1*5 + 2000*25) / 1e6 = 0.1025 -> 0.10.
  function assistantLine(opts: {
    session: string;
    id: string;
    ts: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    c1h: number;
    c5m: number;
  }): string {
    return JSON.stringify({
      type: "assistant",
      sessionId: opts.session,
      cwd: "/Users/test/usage-proj",
      timestamp: `${opts.ts}.000Z`,
      uuid: opts.id,
      message: {
        id: opts.id,
        role: "assistant",
        model: OPUS,
        content: [{ type: "text", text: "x" }],
        usage: {
          input_tokens: opts.input,
          output_tokens: opts.output,
          cache_read_input_tokens: opts.cacheRead,
          cache_creation_input_tokens: opts.cacheWrite,
          cache_creation: {
            ephemeral_1h_input_tokens: opts.c1h,
            ephemeral_5m_input_tokens: opts.c5m,
          },
        },
      },
    });
  }

  async function insertUsage(session: string) {
    const rows = [
      {
        id: `${session}-a`,
        ts: "2026-03-01T10:00:00",
        sidechain: false,
        input: 1000,
        output: 2000,
        cacheRead: 10000,
        cacheWrite: 5000,
        c1h: 3000,
        c5m: 2000,
      },
      // A sidechain message with no usage: it lifts msgs and sidechain_share but adds
      // nothing to the bucket cost, keeping the expected total exact.
      {
        id: `${session}-b`,
        ts: "2026-03-01T10:05:00",
        sidechain: true,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        c1h: 0,
        c5m: 0,
      },
    ];
    let line = 1;
    for (const r of rows) {
      // oxlint-disable-next-line no-await-in-loop -- rows insert in fixture order on one connection so source_line stays deterministic.
      await db.run(
        `INSERT INTO raw
           (host, session_id, type, project_path, is_sidechain, timestamp,
            input_tokens, output_tokens, source_file, source_line, data)
         VALUES ('local', $session, 'assistant', '/Users/test/usage-proj', $sidechain,
                 $ts::TIMESTAMP, $input, $output, $source_file, $source_line, $line::JSON)`,
        {
          session,
          sidechain: r.sidechain ? "true" : "false",
          ts: r.ts,
          input: String(r.input),
          output: String(r.output),
          source_file: `/Users/test/usage-proj/${session}.jsonl`,
          source_line: String(line++),
          line: assistantLine({ session, ...r }),
        },
      );
    }
    await db.run("DELETE FROM meta");
    await rebuildViews(db);
  }

  it("exposes the TTL split and sidechain/source_file columns on message_usage", async () => {
    await insertUsage("usage-cols-session");
    const [row] = await db.query(
      "SELECT cache_1h_tokens, cache_5m_tokens, is_sidechain, source_file FROM message_usage WHERE message_id = 'usage-cols-session-a'",
      z.object({
        cache_1h_tokens: z.bigint(),
        cache_5m_tokens: z.bigint(),
        is_sidechain: z.boolean(),
        source_file: z.string(),
      }),
    );
    expect(Number(row?.cache_1h_tokens)).toBe(3000);
    expect(Number(row?.cache_5m_tokens)).toBe(2000);
    expect(row?.is_sidechain).toBe(false);
    expect(row?.source_file).toContain("usage-cols-session.jsonl");
  });

  it("usage-timeline buckets the session with exact cost and shape signals", async () => {
    await insertUsage("usage-timeline-session");
    const rows = await runQuery(
      db,
      "usage-timeline",
      z.object({
        msgs: z.bigint(),
        cost_usd_est: z.number(),
        cache_miss_ratio: z.number(),
        max_context_tokens: z.bigint(),
        sidechain_share: z.number(),
        top_model: z.string(),
      }),
      {
        session: "usage-timeline-session",
        host: null,
        bucket_minutes: null,
      },
    );
    expect(rows).toHaveLength(1);
    const [b] = rows;
    expect(Number(b?.msgs)).toBe(2);
    expect(b?.cost_usd_est).toBe(0.1);
    expect(b?.cache_miss_ratio).toBe(0.33);
    expect(Number(b?.max_context_tokens)).toBe(16000);
    expect(b?.sidechain_share).toBe(0.5);
    expect(b?.top_model).toBe(OPUS);
  });

  it("usage-spikes ranks the burn window with its repo", async () => {
    await insertUsage("usage-spikes-session");
    const rows = await runQuery(
      db,
      "usage-spikes",
      z.object({
        session_id: z.string(),
        repo: z.string().nullable(),
        msgs: z.bigint(),
        cost_usd_est: z.number(),
      }),
      {
        after_date: null,
        before_date: null,
        project: null,
        host: null,
        bucket_minutes: null,
        limit: null,
      },
    );
    const mine = rows.find((r) => r.session_id === "usage-spikes-session");
    expect(mine).toBeDefined();
    expect(mine?.repo).toBe("usage-proj");
    expect(Number(mine?.msgs)).toBe(2);
    expect(mine?.cost_usd_est).toBe(0.1);
  });

  it("top-sessions ranks the session by cost with host and repo", async () => {
    await insertUsage("top-sessions-session");
    const rows = await runQuery(
      db,
      "top-sessions",
      z.object({
        session_id: z.string(),
        host: z.string(),
        repo: z.string().nullable(),
        msgs: z.bigint(),
        cost_usd_est: z.number(),
      }),
      {
        after_date: null,
        host: null,
      },
    );
    const mine = rows.find((r) => r.session_id === "top-sessions-session");
    expect(mine).toBeDefined();
    expect(mine?.host).toBe("local");
    expect(mine?.repo).toBe("usage-proj");
    expect(Number(mine?.msgs)).toBe(2);
    expect(mine?.cost_usd_est).toBe(0.1);
  });
});

describe("field-drift query", () => {
  const DriftRow = z.object({
    field: z.string(),
    recent_rows: z.bigint(),
    first_seen: z.string(),
    last_seen: z.string(),
  });

  // The fixture corpus stands in for the real one: `toolDenialKind` appears only on and
  // after 2024-01-20, `promptSource` straddles that date. `cutoff_date` pins the boundary
  // so the case does not decay as wall-clock time moves past `new_days`.
  function driftParams(overrides: Record<string, string | null> = {}) {
    return {
      new_days: null,
      cutoff_date: "2024-01-20",
      min_rows: "1",
      sample_pct: "100",
      host: null,
      ...overrides,
    };
  }

  it("reports a field that arrived on an existing record kind", async () => {
    const rows = await runQuery(db, "field-drift", DriftRow, driftParams());
    const denial = rows.find((r) => r.field === "user:$.toolDenialKind");
    expect(denial).toBeDefined();
    expect(Number(denial?.recent_rows)).toBe(5);
    expect(denial?.first_seen).toBe("2024-01-20");
  });

  it("stays silent on a field that predates the cutoff", async () => {
    const rows = await runQuery(db, "field-drift", DriftRow, driftParams());
    expect(rows.map((r) => r.field)).not.toContain("user:$.promptSource");
  });

  it("honors min_rows", async () => {
    const rows = await runQuery(db, "field-drift", DriftRow, driftParams({ min_rows: "500" }));
    expect(rows).toEqual([]);
  });

  it("samples deterministically, so a rerun walks the same rows", async () => {
    const params = driftParams({ sample_pct: "50" });
    const first = await runQuery(db, "field-drift", DriftRow, params);
    const second = await runQuery(db, "field-drift", DriftRow, params);
    expect(first).toEqual(second);
  });
});
