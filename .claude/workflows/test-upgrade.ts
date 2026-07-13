export const meta = {
  name: "test-upgrade",
  description: "Fan out per-unit test refactors (tables, snapshots, properties) into one PR per unit",
  whenToUse:
    "To apply the testing rule's technique-selection guide across existing suites, one test-upgrade-<unit> PR per unit. args: {units?: string[], targets?: {[unit]: string}}",
  phases: [
    { title: "Ground", detail: "load the technique-selection rule text once" },
    { title: "Discover", detail: "enumerate units that have test files" },
    { title: "Audit", detail: "read each unit's tests against the rule, emit a worklist" },
    { title: "Apply", detail: "refactor in isolated worktrees; mechanical work on sonnet" },
    { title: "Verify", detail: "test, review the diff, branch, push, open the PR" },
  ],
};

const UNITS_SCHEMA = {
  type: "object",
  required: ["units"],
  properties: {
    units: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "paths"],
        properties: {
          name: { type: "string" },
          paths: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

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
    "Return, verbatim, the '## Technique Selection' section of .claude/rules/testing.md in the current repo.",
    "No commentary.",
  ].join("\n"),
  { label: "ground:rule-text", phase: "Ground", effort: "low" },
);

phase("Discover");
const discovered = await agent(
  [
    "Enumerate the test units of the current repo. A unit is a directory that owns *.test.ts files and maps to one CI job:",
    "- each plugins/<name> directory containing test files (name = plugin dir name)",
    "- each packages/<name> directory containing test files",
    "- root-level directories with test files (scripts/, hooks/, .claude/), named after the directory",
    "Paths are repo-relative. Do not modify anything.",
  ].join("\n"),
  { label: "discover:units", phase: "Discover", effort: "low", schema: UNITS_SCHEMA },
);

const units = discovered.units.filter(
  (u) => !Array.isArray(args?.units) || args.units.includes(u.name),
);
const hints = args?.targets ?? {};
log(`${units.length} units to audit`);

function testCommand(unit) {
  return `bun test ${unit.paths.map((p) => `./${p}`).join(" ")}`;
}

function auditPrompt(unit) {
  const hint = hints[unit.name];
  return [
    `Audit the tests under ${unit.paths.join(" and ")} against the repo's testing technique-selection rule.`,
    "",
    "Rule text:",
    ground,
    "",
    hint ? `Known candidates from an earlier survey (verify each, extend or drop as the code warrants): ${hint}` : "",
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
    "Rule text:",
    ground,
    "",
    `Worklist for ${unit.name}:`,
    JSON.stringify(items, null, 2),
    "",
    "Hard constraints: no behavior change (the same things are asserted before and after), net test LOC down,",
    `and \`${testCommand(unit)}\` green when you finish.`,
    "Use `bun test <file> --update-snapshots` to fill inline snapshots, then review what it wrote.",
    "Run `bunx biome check --write` on every file you changed: the formatter reflows table/array literals and the linter catches issues like arrow-body forEach returning a value. CI runs `bun run check` and fails the whole job on one error.",
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
    "Rule text:",
    ground,
    "",
    `Worklist for ${unit.name}:`,
    JSON.stringify(items, null, 2),
    "",
    "For each property: one fc.assert(fc.property(...)) with expect inside, plus a small example table if none exists.",
    "Constrain arbitraries (or fc.pre) rather than filtering. Define typed fc.record arbitraries next to the tests.",
    "Seed-check every property: temporarily mutate the target function, confirm the property fails and shrinks, then revert the mutation.",
    `Finish with \`${testCommand(unit)}\` green.`,
    "Run `bunx biome check --write` on every file you changed. CI runs `bun run check` and fails on one lint or format error.",
    "If an invariant does not actually hold, do not weaken it to pass: record an escalation instead.",
    "Return the absolute path of your worktree (pwd) as 'worktree'.",
  ].join("\n");
}

function verifyPrompt(unit, audit, workspace, escalations) {
  return [
    `cd ${workspace}. This worktree holds uncommitted test refactors for ${unit.name}.`,
    "",
    `1. Run \`AGENT=1 ${testCommand(unit)}\` and require it green.`,
    "2. Run `bun run check` (biome) and require it clean. This is the same gate CI's `lint` job runs, and it fails the job on a single format or lint error. Biome truncates output at 20 diagnostics and the repo carries pre-existing warnings, so scope it to your changed files (`bunx biome check <files>`) to surface the real error. Apply `bunx biome check --write` for safe fixes; hand-fix the rest (e.g. an arrow-body `forEach` that returns `expect(...)` becomes a block body). Do not push until this is clean.",
    "3. Review `git diff` in full: refactored sites must assert the same things as before, and pure refactors must reduce LOC.",
    "   Property tests may add lines. Recompute the unit's test LOC (wc -l over *.test.ts) as testLocAfter.",
    `   Test LOC before the refactor was ${audit.testLoc}.`,
    `4. Outstanding escalations from the apply stage: ${escalations.length ? escalations.join("; ") : "none"}.`,
    "   If any escalation or diff concern makes the change unsafe to ship as-is, return status 'escalated' with notes and stop before pushing.",
    `5. Otherwise: \`git checkout -b test-upgrade-${unit.name}\`, commit everything with subject \`test(${unit.name}): apply testing conventions\`,`,
    "   push with -u, and open a PR by following plugins/pull-request/skills/create/SKILL.md (read it from the worktree).",
    `   The PR body must state test LOC before (${audit.testLoc}) and after, what was tabled/snapshotted, and each property's invariant.`,
    "6. Return status 'pr' with the PR URL, or 'skipped'/'escalated' with notes. Never guess on a judgment call: escalate it.",
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
