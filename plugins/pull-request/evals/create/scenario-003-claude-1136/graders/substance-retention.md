---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line, such as a note that the push or create command failed. Pass when the body carries what a reviewer needs from the session notes below: the load-bearing decisions with the evidence behind them, rejected alternatives a reviewer would otherwise re-propose, and deferred work. Leaving out a note that would not change a reviewer's reading is correct pruning. Fail when a needed decision is missing, or appears without the evidence that supports it.

- Gap measurement: the work machine spent 25% of its weekly herdr calls re-probing --help because no skill documented the CLI.
- herdr ships five stable releases in five weeks plus near-weekly previews, so any copied command table would go stale within a release cycle; the skill instead teaches a discovery protocol and states that the CLI wins wherever the two disagree.
- orient.sh bang-executes a jq projection over herdr api snapshot, replacing four separate list calls and surfacing the live version and protocol first.
- Verified against a running v0.7.5: structured queries return single-line JSON but pane read, agent read, and agent explain return plain text; --source visible works on a fresh pane while recent returns empty; pane run executes through an interactive shell that inherits per-directory mise activation; agent_status is scraped from the screen rather than reported by a hook; agent_session.value carries the Claude session UUID for an exact pane-to-session join; worktree creation stays with worktrunk.
- orient.sh is guarded on HERDR_PANE_ID so a missing socket doesn't print a raw stack-trace fragment.
- Deliberately left the tmux plugin in place: a stale view made it look dead everywhere, but re-syncing that host showed both multiplexers still operational, with list-panes and capture-pane used in the last two days.
- Removal criterion: the --help re-probe count, tracked via the session index; the skill goes if that count holds steady or the skill goes unloaded for two consecutive weeks.
