---
paths:
  - "**/*.test.ts"
  - "**/*.integration.ts"
  - ".github/workflows/**"
---

# Test Mechanics

Run everything with `bun test`, or filter by plugin with `bun test plugins/<name>`.

After changing a plugin script, run it directly with real arguments as well as its unit tests. Argument parsing and other integration failures only surface at runtime.

## Conventions

- **Integration tests are not auto-discovered.** Bun discovers `*.test.ts`. Run `*.integration.ts` by passing paths explicitly.
- **Prefix dotdir paths with `./`.** A positional arg is a filter, matched against discovered paths, and discovery skips dotdirs. `bun test .claude/hooks` matches nothing and exits 1 with a "files were searched" note. `bun test ./.claude/hooks` runs them.
- **No `.js` imports in TypeScript.** Import from `./module`, not `./module.js`.
- **No module mocking.** `local/no-module-mocking` bans `mock.module`, which patches the module registry process-wide and leaks into later tests. Pass the dependency in as a parameter with a default, or `spyOn` an object you own.
- **Assertion chains are allowed in tests only.** `local/no-chained-type-assertions` is off under `**/*.test.ts` so a test can build a deliberately-invalid input for a rejection path. Everywhere else the chain has to go.
- **Prefer skills over agents** for anything that should be directly invocable. Skills are invocable via the `Skill` tool.
- **Hook E2E tests drive the real dispatcher.** A unit test proves the script's logic, not that Claude Code dispatches to it. Run headless `claude -p` with `--plugin-dir` against a throwaway repo with the external CLI (`gh`, `glab`) stubbed onto `PATH`, then assert on what the stub recorded. These live at `plugins/<name>/scripts/e2e-*.ts` and run in CI only, from a path-filtered workflow holding the `CLAUDE_CODE_OAUTH_TOKEN` secret, because each run spends API tokens.
- **Capture check and test output once.** `bun run check` and `bun test` re-execute the whole gate every time. Redirect on the first run (`bun run check 2>&1 | tee tmp/check.log | tail -n 50`) and read further into `tmp/check.log` with `sed`.

## CI Structure

`.github/workflows/test.yml` runs one matrix job per plugin, a `hooks` job over `./.claude ./user scripts/`, and a `validate` job over `packages/`. New plugin tests join the existing matrix instead of getting their own job.
