---
paths:
  - "**/*.test.ts"
  - "**/*.integration.ts"
  - ".github/workflows/**"
---

# Test Mechanics

After changing a plugin script, run it directly with real arguments as well as its unit tests. Argument parsing and other integration failures only surface at runtime.

## Conventions

- **Integration tests are not auto-discovered.** Bun discovers `*.test.ts`. Run `*.integration.ts` by passing paths explicitly.
- **Prefix dotdir paths with `./`.** A positional arg is a filter, matched against discovered paths, and discovery skips dotdirs. `bun test .claude/hooks` matches nothing and exits 1 with a "files were searched" note. `bun test ./.claude/hooks` runs them.
- **No `.js` imports in TypeScript.** Import from `./module`, not `./module.js`.
- **No module mocking.** Pass the dependency in as a parameter with a default, or `spyOn` an object you own (`local/no-module-mocking`).
- **Assertion chains are allowed in tests only.** `local/no-chained-type-assertions` is off under `**/*.test.ts` so a test can build a deliberately-invalid input for a rejection path. Everywhere else the chain has to go.
- **Hook E2E tests drive the real dispatcher.** A unit test proves the script's logic, not that Claude Code dispatches to it. Run headless `claude -p` with `--plugin-dir` against a throwaway repo with the external CLI (`gh`, `glab`) stubbed onto `PATH`, then assert on what the stub recorded. These live at `plugins/<name>/scripts/e2e-*.ts` and run in CI only, from a path-filtered workflow holding the `CLAUDE_CODE_OAUTH_TOKEN` secret, because each run spends API tokens.

## Property Tests

This repo writes properties with [Hegel](https://hegel.dev) (`@hegeldev/hegel`): one property plus a small example table, `expect` inside the body.

```ts
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

test("encode/decode roundtrip", () => {
  hegel.test((tc) => {
    const values = tc.draw(gs.arrays(gs.integers()));
    expect(decode(encode(values))).toEqual(values);
  });
});
```

- Use `await hegel.testAsync(...)` for async bodies.
- `tc.assume(condition)` skips a case. Constrain the generator (`gs.integers({ minValue: 1 })`, `gs.text({ minSize: 1 })`) before using it.
- `gs.text()` draws full Unicode. Narrow it with `alphabet` or codepoint bounds only when real inputs are narrower.
- Build reusable domain values with `gs.record` or `gs.composite` beside the tests.
- A failure prints the shrunk draws as `var draw_N = ...`. Hegel saves failing examples to `.hegel/` in the working directory and replays them first on the next run.

## CI Structure

New plugin tests join the existing matrix in `.github/workflows/test.yml` instead of getting their own job.

A pull request runs only the plugins its changed files name. A plugin whose tests cover something outside its own directory, such as a checked copy of another plugin's file, declares those paths in `plugins/<name>/.ci.json` under `paths` so a change there selects it too.

A plugin whose tests drive an external CLI pins it in `plugins/<name>/mise.toml`, which the job installs through `mise-action` and Renovate keeps current. Exercise the real binary from a `*.integration.ts`. `runner` in `.ci.json` accepts a list for per-platform behavior.
