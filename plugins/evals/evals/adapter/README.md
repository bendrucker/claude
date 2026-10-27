# Adapter

Measures whether a session can write a working `Adapter` (`packages/evals/adapter.ts`) for an eval framework it has never seen wired to the climb tooling, and what context it needs. Each case scaffolds a toy project in one framework with one stored run of it, and asks for `./adapter.ts`. The runner collects that file, and `scripts/score.ts` executes it against a second stored run the session never saw, grading each operation.

Cases are `<framework>-<context>`. `interface` gives the session a copy of `packages/evals` in `./evals/`. `guide` adds `harnesses.md`. pydantic-evals is `dev` and promptfoo is `holdout`.

## Running

The suite is local-only, and its sessions need Bash, which a run nested in a sandboxed Claude Code session can't start, so run it on CI:

```bash
gh workflow run eval.yml --ref evals-plugin -f suite=plugins/evals/evals/adapter -f args='--ablation none --runs 3'
```

`bun test plugins/evals/evals/adapter` checks the scorer against hand-written adapters.

## Graders

| Grader | Passes when |
| --- | --- |
| `loads` | `resolveAdapter` accepts the module |
| `read` | pass counts per case, arm, and grader equal `held/truth.json` |
| `tags` | every case maps to tags that include its truth tags |
| `traces` | each cell's replies equal the truth |
| `rescore` | after `rescore.patch` edits a grader, the flips match the truth and `read` turns the returned path into the held counts with those verdicts reversed, or the adapter throws when the truth says the framework can't re-score |
| `run` | `run(project, { ref: "base", args: [] })` returns a path `read` turns into the held counts, and the stub log shows the `base` prompt on the with arm |

`rescore` and `run` check their output through `read`, so a broken `read` fails them too.

## Frameworks

Each framework lives in `frameworks/<name>/`:

- `project/`: the toy project, written as a user of the framework would write it. `prompt.txt` is the artifact under test, and the project runs each case with it and without it. Its `README.md` names the framework's real run command.
- `setup.sh <dest>`: copies `project/` to `<dest>` as a git repo whose `base` tag carries a different `prompt.txt`, then writes the working one. The scaffold and the scorer both call it.
- `fixtures/seen/` and `fixtures/held/`: real stored runs as the framework writes them, recorded once by `gen.ts` with a deterministic stub model, so pass counts differ between the two. The session sees `seen`, and the scorer reads `held`.
- `fixtures/<run>/truth.json`: what a correct adapter reports, in the shape `Truth` in `scripts/truth.ts` defines.
- `fixtures/held/rescore.patch`: a grader edit, applied to a `setup.sh` copy before `rescore`.
- `stub/bin/<command>`: a stand-in for the framework's run command. It appends `{ argv, cwd, prompt }` to `$ADAPTER_STUB_LOG`, where `prompt` is the sha256 of `prompt.txt` in its working directory or `null` when absent, then copies `fixtures/${ADAPTER_FIXTURE:-seen}/` beside its `stub/` directory to where its arguments point, as the real command would write it. Its `prompt.txt` hash decides nothing: the output is the stored run either way. Every other use of the command, such as a replay that re-grades stored outputs or a script that reads the project, goes to the real tool, so an adapter isn't held to one way of calling it.
- `test-adapters/correct.ts` passes every grader, and each `test-adapters/broken-<grader>.ts` wraps it with one mistake that fails that grader. `adapters.test.ts` asserts both.

`gen.ts` runs the real framework in a throwaway environment under `tmp/`. Nothing it installs is declared in this repo.
