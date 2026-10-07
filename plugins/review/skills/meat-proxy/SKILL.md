---
name: review:meat-proxy
description: >
  Draft a short reply that hands an AI-relayed PR, MR, doc, or message back to its author with
  motivation and scope questions only the author can answer. Use when the author piped the work
  and each round of feedback through a model without reading it, and the reviewer is ending up
  as the real author.
argument-hint: "<target> [reaction]"
disable-model-invocation: true
allowed-tools:
  - Bash(gh:*)
  - Bash(glab:*)
  - Bash(git:*)
  - Agent
---

# Meat Proxy

Target and reaction: $ARGUMENTS

The author of this artifact relayed model output without reading, checking, or owning it. Each round of review feedback goes back into the model, so the reviewer ends up doing the authoring. Your job is to hand the work back: draft a short reply in my voice that makes the author engage with their own change, and keep everything else private to me. A good reply asks things the author must think about to answer, and leaves the finding to them.

You draft only. Never post, comment, approve, or react on any platform or chat. I copy the draft myself.

## Inputs

- **Target**: the first argument. A PR or MR URL, a doc link, or pasted text. Fetch PRs through `gh`, MRs through `glab` (load `gitlab:merge-request` for GitLab), and docs through whatever reads them.
- **Reaction**: everything after the target, optional. My one-line gut call about what's wrong. Test it against the artifact before using it. When it holds, frame the questions around it. When it doesn't, frame them around what does hold and say why in the private notes.
- **Author answers**: text pasted after a previous round's draft went out. Treat it as this round's input alongside the fetched thread.

## State

Keep one state file per target at `tmp/meat-proxy/<slug>.md` under `git rev-parse --show-toplevel`. Build the slug from the target: `owner-repo-123` for a PR or MR, a short kebab-case name for a doc or pasted text.

When the file exists, this is a follow-up round. Read it first, then follow [Follow-Up Rounds](#follow-up-rounds).

The file records, per round:

- round number and target
- the reaction and its verdict
- the draft as written
- the held findings
- `engaged`: whether the author's answers engaged with the questions, filled in on the next round
- `outcome`: whether I kept, edited, or dropped the draft, filled in on the next round

## Reading

Read every part of the artifact: the description, the diff or document, and every comment thread. Small artifacts you read inline.

For a large PR or MR, dispatch one `analyst` subagent with `model: sonnet`. Brief it that the work is probably model-generated and may be narrow, naive, or incomplete. Ask it for:

- what problem the change claims to solve, and whether the change shows that problem exists
- where the change draws its scope, and the adjacent code or cases it leaves out
- what the author never checked: callers, existing patterns that already solve this, tests that exercise the real path, docs or config the change contradicts
- line-level defects, each with `file:symbol` and one line of evidence

It returns findings only, no diff text.

Judge engagement from the artifact itself. Signs of engagement are answers that reference specifics of the codebase, a description that explains a trade-off, or a reply that pushes back with reasons. When the artifact shows engagement, flag it in the private notes with the evidence and still write the draft.

## Draft

The draft is 2 to 5 sentences in my voice. Follow [tone.md](../peer/tone.md) for address and register: no greeting, no thanks, open with substance.

- Lead with a motivation question (what need prompted this change) or a scope question (what made the author draw the line where they did). Ask one or both.
- Ask questions that depend on context only the author has: the incident, the user, the deadline, the reason this file and not its neighbor. A model given the question and the diff should be unable to answer it.
- Add exactly one pointer to where they should look: a file, an existing pattern, a doc. Name the place. Leave what they'll find there for them to discover.
- Pick one to three points from everything you read. Hold back the rest.

The draft is neutral and assumes good faith. It never names the pattern, mentions AI, models, or proxying, or judges the author. It asks questions, and leaves out demands for proof, test output, screenshots, and checklists.

## Private Notes

After the draft, give me notes in chat that never go to the author:

- **Held findings**: the line-level findings you left out of the draft, each with `file:symbol` and one line.
- **Reaction**: whether my reaction held, with the evidence. Omit when I gave none.
- **Engagement**: present only when the artifact shows engagement, with the evidence.

## Follow-Up Rounds

When the state file exists:

1. Ask me whether I kept, edited, or dropped the last draft, and record it as `outcome`.
2. Read the author's new answers and commits against the previous draft's questions and the held findings.
3. Record `engaged` for the previous round: yes when the answers carry author-only context or a change reflects the pointer, no when they restate the diff, paraphrase the question back, or answer a different question.
4. Write a narrower draft on the question they dodged, under the same draft rules. When they answered everything, ask about the most important held finding instead.
5. In the private notes, add a recommendation: one more round, take it over myself, or close it. Give the reason in one line.

The follow-up draft stays inside the same rules as round one, however the author answered.

## Done

The run is done when the chat shows the draft in a fenced block followed by the private notes, and the state file holds this round's entry.
