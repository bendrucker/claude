# Searching for Candidates

Each mode needs a text search to find the obvious copies and a behavior search to find the rest. Prefer `ast-grep` for structure and `rg` for text. Use whatever the repository's ecosystem offers in their place.

## Project Inventory

Read these before naming any replacement, and record what they say in the report's scope line:

- The manifest and lockfile: what is already a dependency, directly or transitively.
- The runtime minimum: `engines`, `.tool-versions`, `mise.toml`, `requires-python`, `go.mod`, a CI matrix, or a published package's declared support range. A built-in newer than the minimum is unavailable to some users.
- The compile or type-check target per directory: `tsconfig` `lib` and `target`, nested `tsconfig` files, Babel or bundler targets. One directory can lack a built-in the rest of the repository has.
- Existing uses of the replacement. `rg` for the built-in or package name. A replacement already in use somewhere proves it works on this toolchain.
- Lint caps on size and complexity (`max-lines`, `complexity`, `max-statements`). They state the project's own threshold for a split.

## Upstream

Search for hand-written versions of the patterns in port's [`patterns.md`](../../port/references/patterns.md).

- **By text.** Grep for the signatures of a hand-roll: a character-class `replace` building a regex, `JSON.parse(JSON.stringify(`, `new Promise((r) => setTimeout(`, a `setTimeout` that calls `kill`, a loop over `argv`, `padEnd` in a loop, raw `\x1b[` escapes, `split(",")` on lines, `split(".")` on versions, `"'" + s.replace(` for shell quoting.
- **By name.** List functions whose names say what a library does: `escape`, `quote`, `parse`, `format`, `slug`, `retry`, `sleep`, `clone`, `glob`, `which`, `table`, `color`, `duration`.
- **By behavior.** Search for the literals a reinvention must contain: the metacharacter set, the ANSI escape prefix, a unit table (`ms`, `s`, `m`, `h`), a list of HTML entities, a semver regex.

Group the hits by pattern, count the copies, and note which copies differ from each other. Then check each pattern against the keep criteria before verifying.

## Split

Rank files by size and churn together, then read the top of that list.

```sh
git ls-files -z | xargs -0 wc -l | sort -rn | head -40
git log --since=60.days --format= --name-only | sort | uniq -c | sort -rn | head -40
```

Report raw lines and code lines (non-blank, non-comment) for each file, and the churn window you used.

For each file near the top of both lists:

- List its responsibilities by grouping top-level definitions by the state they share and the callers that use them, following the cut rules in [split](../../split/SKILL.md#choose-the-cut). A file whose definitions all share one state is one responsibility, whatever its size.
- Count exports and importers.
- Record the hazards a split must preserve: work done at import time, an entrypoint guard such as `import.meta.main` or `if __name__ == "__main__"`, paths derived from the file's own location, handler or registration order, paths that config, CI, or tests name, lint overrides keyed on names, and names already taken in the target directory.
- Propose the cut as a list of new modules, each with its purpose and the names it takes. Mark definitions whose shared state you did not confirm, since they can force extra modules once the split starts.

## Dedupe

- **By text.** Find byte-identical files with a hash: `git ls-files -z | xargs -0 sha1sum | sort | uniq -w40 -D`. Use a clone detector such as `jscpd` when it is installed.
- **By name.** Search for one function name across the tree, and for its variants: `normalize`, `canonical`, `clean`, `toSlug`, `slugify`.
- **By behavior.** Search for the distinctive literal each copy must contain: the same regex, the same error message, the same magic number, the same field list. Copies rewritten in another style still share these.

For each group, record every copy with its callers and the unit it ships in. Copies in units that cannot share code go to the rejected list unless a shared package is worth its cost.
