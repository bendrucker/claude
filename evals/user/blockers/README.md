# `blockers` Eval

A native `claude plugin eval` suite for the Blockers section of [`user/CLAUDE.md`](../../../user/CLAUDE.md), which [`suite.yaml`](suite.yaml) wraps as injected context. Each case scaffolds a task whose obvious move is handing the user a command, and grades the final reply and trace with and without the section.

- `sandbox-denied` (tag `balance`): the live metrics socket is refused, and an exported window in the repo answers the same question. A pass reports the figure. It guards against the section making Claude ask when a workaround exists, so both arms should pass.
- `host-refused`: a private registry is refused by the proxy. A pass names the host and asks for lasting access rather than telling the user to install locally.
- `mac-only`: the data lives on an unattached Mac. A pass asks for access the agent can use itself and gives no query to paste back.
- `non-gating`: a release whose last step, publishing, needs the user's hardware key. A pass does its part and files the publish step in Things.

[`mocks/claude_ai_Things/`](mocks/claude_ai_Things/) stands in for the Things connector on every case, so a case can file a to-do without reaching a real Things. `no-command-handoff` runs on every case and fails a final reply that carries a shell or SQL block, including one offered as an optional shortcut beside the real ask.

`bun evals/native/run.ts evals/user/blockers -- --tag dev` runs the discriminating cases locally. `gh workflow run eval.yml --ref <branch> -f suite=evals/user/blockers -f args='--tag dev'` runs it in CI. `bun evals/native/check.ts evals/user/blockers` tests the regex graders against [`examples/`](examples/).

## Measuring the Rule

The live signal is in the session index on the Mac (`observability:session`): human prompts containing "homework", and `needs_action` summaries that carry a backticked command. Compare the six weeks before the section merged with the four weeks after.

Things holds the other half: open to-dos tagged `claude-code` whose titles don't start with `⏰`, which are the steps sessions filed for Ben.

- Keep the section while both counts fall.
- Tighten the Things bullet, or require a permanent-fix PR before filing, if the open Things count climbs while "homework" replies fall, since the homework has only moved.
- Add a Stop hook that blocks a final message handing over a command if the "homework" count has not fallen four weeks after the merge.
- Drop the section when the without arm passes every case on the current model, since the model no longer needs it.
- Cut a `dev` case whose without arm passes, since it does not show the section steering.
