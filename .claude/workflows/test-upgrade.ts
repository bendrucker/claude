export const meta = {
  name: "test-upgrade",
  description: "Fan out per-plugin test refactors (tables, snapshots, properties) into one PR per unit",
  whenToUse: "After the testing technique-selection rule is on main, to upgrade existing test suites unit by unit",
  phases: [
    { title: "Ground", detail: "load the rule and reference text once" },
    { title: "Audit", detail: "read each unit's tests against the rule, emit a worklist" },
    { title: "Apply", detail: "refactor in isolated worktrees; mechanical work on sonnet" },
    { title: "Verify", detail: "test, review the diff, branch, push, open the PR" },
  ],
};

const REPO = "/Users/ben/src/bendrucker/claude";

const ALL_UNITS = [
  {
    name: "writing",
    paths: ["plugins/writing"],
    targets:
      "hooks/numbering.test.ts (language-by-pattern matrix as one table), detection/tropes.test.ts (tables), voice-delta.test.ts and ngram.test.ts (inline snapshots), linguistics/preprocess.ts (idempotence property)",
  },
  {
    name: "type-ignore",
    paths: ["plugins/type-ignore"],
    targets: "hooks/detect.test.ts (~30 near-identical blocks as a language-by-token table)",
  },
  {
    name: "gitlab",
    paths: ["plugins/gitlab"],
    targets:
      "watch.test.ts (tables for parseProject, normalizePipelineStatus, parseMrUrl), fetch.test.ts (inline snapshots), merge-request/scripts/diff.ts (hunk membership property)",
  },
  {
    name: "github",
    paths: ["plugins/github"],
    targets: "watch.test.ts (deriveChecksState table), fetch.test.ts (inline snapshots)",
  },
  {
    name: "tmux",
    paths: ["plugins/tmux"],
    targets: "hooks/target.test.ts (tables), injectTarget to hasExistingTarget roundtrip property",
  },
  {
    name: "comments",
    paths: ["plugins/comments"],
    targets:
      "detection/rank.ts properties (permutation invariance, idempotence, no drops or dupes), apply/edits.ts properties (order independence, unedited-region preservation)",
  },
  {
    name: "claude-code",
    paths: ["plugins/claude-code", "packages/skill-lint"],
    targets:
      "session/scripts/db.test.ts (field-by-field expects to inline snapshots), skill-lint rules as a table",
  },
  {
    name: "pull-request",
    paths: ["plugins/pull-request"],
    targets: "scripts/validate.test.ts (formatted messages to inline snapshots)",
  },
  {
    name: "scripts",
    paths: ["scripts"],
    targets:
      "scripts/coverage/lcov.ts properties: formatRanges roundtrip and order independence, merge commutativity, covered/uncovered partition",
  },
];

const AUDIT_SCHEMA = {
  type: "object",
  required: ["skip", "items", "testLoc"],
  properties: {
    skip: { type: "boolean" },
    reason: { type: "string" },
    testLoc: { type: "integer" },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["file", "technique", "sites"],
        properties: {
          file: { type: "string" },
          technique: {
            enum: ["table", "inline-snapshot", "file-snapshot", "property", "arbitrary"],
          },
          sites: { type: "string" },
          invariant: { type: "string" },
        },
      },
    },
  },
};

const APPLY_SCHEMA = {
  type: "object",
  required: ["worktree", "summary", "escalations"],
  properties: {
    worktree: { type: "string" },
    summary: { type: "string" },
    escalations: { type: "array", items: { type: "string" } },
  },
};

const VERIFY_SCHEMA = {
  type: "object",
  required: ["status", "notes"],
  properties: {
    status: { enum: ["pr", "skipped", "escalated"] },
    pr: { type: "string" },
    notes: { type: "string" },
    testLocAfter: { type: "integer" },
  },
};

phase("Ground");
const ground = await agent(
  [
    `Return, verbatim and clearly delimited, the contents of two files in ${REPO}:`,
    "1. The '## Technique Selection' section of .claude/rules/testing.md",
    "2. All of plugins/bun/skills/bun/references/testing.md",
    "No commentary.",
  ].join("\n"),
  { label: "ground:rule-text", phase: "Ground", effort: "low" },
);

const units = Array.isArray(args?.units)
  ? ALL_UNITS.filter((u) => args.units.includes(u.name))
  : ALL_UNITS;

function auditPrompt(unit) {
  return [
    `Audit the tests under ${unit.paths.map((p) => `${REPO}/${p}`).join(" and ")} against the repo's testing technique-selection rule.`,
    "",
    "Rule and API reference:",
    ground,
    "",
    `Known candidates from an earlier survey (verify each, extend or drop as the code warrants): ${unit.targets}`,
    "",
    "Read every *.test.ts file in the unit. Emit a worklist item per opportunity:",
    "- technique 'table': two or more test() blocks differing only in data",
    "- technique 'inline-snapshot': field-by-field assertions on one structured value, or formatted output asserted piecemeal",
    "- technique 'file-snapshot': only when output exceeds roughly 20 lines or is shared across tests",
    "- technique 'property': a pure function in the unit with a statable invariant; name the invariant in the 'invariant' field",
    "- technique 'arbitrary': tests hand-building filler instances of a domain type that a typed fc.record arbitrary or make<Type>(overrides) builder should produce",
    "In 'sites', identify the test names or line ranges involved.",
    "Set testLoc to the total line count of the unit's *.test.ts files (wc -l).",
    "If nothing meets the bar, return skip=true with a reason. Do not modify any files.",
  ].join("\n");
}

function mechanicalPrompt(unit, items) {
  return [
    "You are in an isolated git worktree of this repo. Run `bun install` first (workspace deps are not installed).",
    "",
    "Apply ONLY the table and snapshot refactors below. Do not add property tests. Do not commit.",
    "",
    "Rule and API reference:",
    ground,
    "",
    `Worklist for ${unit.name}:`,
    JSON.stringify(items, null, 2),
    "",
    "Hard constraints: no behavior change (the same things are asserted before and after), net test LOC down,",
    `and \`bun test ${unit.paths.map((p) => (p.startsWith(".") ? `./${p}` : p)).join(" ")}\` green when you finish.`,
    "Use `bun test <file> --update-snapshots` to fill inline snapshots, then review what it wrote.",
    "If a refactor would change what is asserted, leave that site alone and record it as an escalation.",
    "Return the absolute path of your worktree (pwd) as 'worktree'.",
  ].join("\n");
}

function propertyPrompt(unit, items, workspace) {
  return [
    workspace
      ? `Work in the existing worktree at ${workspace} (it already contains table/snapshot refactors). cd there first.`
      : "You are in an isolated git worktree of this repo.",
    "Run `bun install` in the worktree if node_modules is missing.",
    "",
    "Add the property tests and arbitraries below. Do not commit.",
    "",
    "Rule and API reference:",
    ground,
    "",
    `Worklist for ${unit.name}:`,
    JSON.stringify(items, null, 2),
    "",
    "For each property: one fc.assert(fc.property(...)) with expect inside, plus a small example table if none exists.",
    "Constrain arbitraries (or fc.pre) rather than filtering. Define typed fc.record arbitraries next to the tests.",
    "Seed-check every property: temporarily mutate the target function, confirm the property fails and shrinks, then revert the mutation.",
    `Finish with \`bun test ${unit.paths.map((p) => (p.startsWith(".") ? `./${p}` : p)).join(" ")}\` green.`,
    "If an invariant does not actually hold, do not weaken it to pass: record an escalation instead.",
    "Return the absolute path of your worktree (pwd) as 'worktree'.",
  ].join("\n");
}

function verifyPrompt(unit, audit, workspace, escalations) {
  return [
    `cd ${workspace}. This worktree holds uncommitted test refactors for ${unit.name}.`,
    "",
    `1. Run \`AGENT=1 bun test ${unit.paths.map((p) => (p.startsWith(".") ? `./${p}` : p)).join(" ")}\` and require it green.`,
    "2. Review `git diff` in full: refactored sites must assert the same things as before, and pure refactors must reduce LOC.",
    "   Property tests may add lines. Recompute the unit's test LOC (wc -l over *.test.ts) as testLocAfter.",
    `   Test LOC before the refactor was ${audit.testLoc}.`,
    `3. Outstanding escalations from the apply stage: ${escalations.length ? escalations.join("; ") : "none"}.`,
    "   If any escalation or diff concern makes the change unsafe to ship as-is, return status 'escalated' with notes and stop before pushing.",
    `4. Otherwise: \`git checkout -b test-upgrade-${unit.name}\`, commit everything with subject \`test(${unit.name}): apply testing conventions\`,`,
    "   push with -u, and open a PR by following plugins/pull-request/skills/create/SKILL.md (read it from the worktree).",
    `   The PR body must state test LOC before (${audit.testLoc}) and after, what was tabled/snapshotted, and each property's invariant.`,
    "5. Return status 'pr' with the PR URL, or 'skipped'/'escalated' with notes. Never guess on a judgment call: escalate it.",
  ].join("\n");
}

phase("Audit");
const results = await pipeline(
  units,
  (unit) => agent(auditPrompt(unit), { label: `audit:${unit.name}`, phase: "Audit", schema: AUDIT_SCHEMA }),
  async (audit, unit) => {
    if (!audit || audit.skip || audit.items.length === 0) return { audit, workspace: null };
    const mechanical = audit.items.filter((i) => i.technique !== "property" && i.technique !== "arbitrary");
    const properties = audit.items.filter((i) => i.technique === "property" || i.technique === "arbitrary");
    let workspace = null;
    const escalations = [];
    if (mechanical.length) {
      const applied = await agent(mechanicalPrompt(unit, mechanical), {
        label: `apply:${unit.name}:mechanical`,
        phase: "Apply",
        model: "sonnet",
        isolation: "worktree",
        schema: APPLY_SCHEMA,
      });
      if (applied) {
        workspace = applied.worktree;
        escalations.push(...applied.escalations);
      }
    }
    if (properties.length) {
      const applied = await agent(propertyPrompt(unit, properties, workspace), {
        label: `apply:${unit.name}:properties`,
        phase: "Apply",
        ...(workspace ? {} : { isolation: "worktree" }),
        schema: APPLY_SCHEMA,
      });
      if (applied) {
        workspace = workspace ?? applied.worktree;
        escalations.push(...applied.escalations);
      }
    }
    return { audit, workspace, escalations };
  },
  async (state, unit) => {
    if (!state || !state.workspace) {
      const reason = state?.audit?.reason ?? "audit or apply produced nothing";
      log(`${unit.name}: skipped (${reason})`);
      return { unit: unit.name, status: "skipped", notes: reason };
    }
    const verdict = await agent(verifyPrompt(unit, state.audit, state.workspace, state.escalations ?? []), {
      label: `verify:${unit.name}`,
      phase: "Verify",
      effort: "low",
      schema: VERIFY_SCHEMA,
    });
    if (!verdict) return { unit: unit.name, status: "escalated", notes: "verify agent died" };
    log(`${unit.name}: ${verdict.status}${verdict.pr ? ` ${verdict.pr}` : ""}`);
    return { unit: unit.name, ...verdict, testLocBefore: state.audit.testLoc };
  },
);

const done = results.filter(Boolean);
return {
  prs: done.filter((r) => r.status === "pr"),
  skipped: done.filter((r) => r.status === "skipped"),
  escalations: done.filter((r) => r.status === "escalated"),
};
