---
name: prompting
description: "Write a document a model executes: a product prompt, a system prompt, a skill, a tool or agent description, a CLAUDE.md or AGENTS.md, a reference file behind a pointer. Use when authoring or revising any of those, when deciding what belongs in a prompt versus behind a pointer, when a prompt produces different behavior from run to run, or when a prompt makes the model take the wrong approach."
---

# Prompting

Rules for any document a model executes. Each rule targets variance: the same document should drive the same process on every run.

To rewrite an existing document, see [references/conversion.md](references/conversion.md).

## Placement

Put material in the body when every run needs it. Put it behind a pointer when only some runs reach it. Leave it unpointed when a human should choose whether to reach it, because a pointer from the body hands that choice to the model.

Move reference that only some branches need out of a step sequence, even when it is short. Leaving it in place makes the model attend to the surrounding steps inconsistently across runs, which costs more than the tokens do.

Bodies hold two kinds of material: the ordered actions the model performs, and the definitions and rules it consults while performing them. Keep a flat list of peer rules flat.

A document can be too long even when every line is live and unique. Past that length the model attends unevenly across it. Move reference behind pointers, then split by case or by sequence so each path carries only what it needs.

## Pointers

A pointer names material outside the context and states when to reach it. A skill description, a `CLAUDE.md` line naming a rule file, a `See <file>` link, and a tool description are all pointers.

The pointer's wording determines whether the model reaches the material. Sharpen the wording before inlining anything.

Write a pointer to state what the material is and which cases trigger it. Prune it harder than the body, because it costs every turn:

- Put the trigger word first.
- One trigger per case. Synonyms for one case are that case written twice.
- Cut identity the body already carries.

## Co-location

Keep a concept's definition, rules, and caveats under one heading. Test a section by reading it alone: it should answer the question it names without sending the reader elsewhere in the file.

## Splitting

Split a sequence when later steps tempt the model to finish the current one early. That works only across a real context break: a hand-off, a subagent dispatch, a separate request. An inline reference leaves the later steps in context.

Do not merge two sequences. Each step becomes visible from the one before it, and the model stops the earlier sequence at the later one's criterion.

## Goal

State the goal first: what the work is for, before any instruction. Then give the constraints and leave room to adapt.

A document that gives the what without the why leaves the model to infer the goal, and it takes the wrong approach when no instruction fits the case. That is the XY problem. The goal lets the model make a trade-off the document never anticipated.

A document that dictates an exact sequence of tool calls degrades output and goes stale as the environment shifts. When a document keeps accreting steps to patch failures, the fix is usually a clearer goal.

Pair the goal with the instructions the model needs to reach it. Each instruction earns its place by correcting where the model goes wrong without it. The goal stays true as models change, and a steering instruction expires when the behavior it patches does. A stronger model takes more of the work from the goal and needs fewer instructions. Fix more of the process in the harness when a cheaper model runs the document.

A goal still needs a completion criterion, or the model decides for itself when the goal is met.

## Completion Criteria

End every unit of work on a completion criterion: the condition that tells the model the work is done.

#### Clarity

Write a criterion the model can check. A vague bound such as "understanding reached" lets the model stop early.

Sharpen the bound first. Split the sequence to hide later work only when the bound cannot be sharpened and you have observed the model stopping early.

#### Demand

Write a criterion that requires the work you want. "Every modified model accounted for" forces a full pass. "Produce a change list" lets the model stop at three items.

Demand does not require steps. "Every rule applied" bounds a flat reference document the same way "every step done" bounds a sequence.

## Leading Words

A leading word is a compact concept from the model's pretraining, reused as the same token every time the rule applies. Repeating the token accumulates a distributed definition, so a few tokens carry a rule that would otherwise take a paragraph.

Choose an existing word before coining one. A coined word recruits nothing from pretraining, so define it in the document or it carries nothing.

In the body, the same word produces the same behavior at each appearance, and inside flat reference it names the class of thing to look for. In a pointer, share the word across the prompt, the docs, and the code so the model links them to the material.

Look for passages that collapse into one token:

- "fast, deterministic, low-overhead" collapses to *tight*, as in a tight loop.
- "a loop you believe in" collapses to *red*: the loop goes red on the bug or it does not.

## Sentence Form

- Imperative: "Keep the title under 50 characters."
- Condition before instruction: "When the repo has a PR template, follow its sections."
- One instruction per sentence. Split a sentence that stacks an instruction, its exception, and its reason.
- Active voice with a named actor: the model, the user, or a tool.
- Present tense and common verbs: write "check" where you would write "interrogate".

State the rule first. When knowing why lets the model handle a case the rule does not list, add the reason after it in one clause. Cut a reason that only argues the rule is right.

Write the literal fact instead of metaphor, epigram, or personification. A figurative phrasing is a weaker match target than a literal one when the model scans for the rule that applies.

#### Positive Form

State the target behavior: "Write one-line comments". A prohibition names the behavior it bans, which makes that behavior more available.

Use an explicit ban only as a hard guardrail with no positive phrasing available. Pair every ban with the positive target.

## Pruning

#### Duplication

Keep each meaning in one place. A leading word is the deliberate exception: it repeats a token, never the meaning.

#### Cache

The environment already states part of what a document would say: package scripts, config files, the directory layout, `--help` output. A document restating it is a cache, and earns its place only when the lookup is expensive.

Cache what the model cannot find by looking: the unwritten convention, the reason behind a choice, the gotcha no config records. Leave one-file and one-command lookups to the environment.

#### No-ops

Delete instructions the model already follows by default. Test each sentence against the model's default: does this line change behavior? Settle a disagreement by running the document. When a sentence fails, delete the whole sentence.

Replace a leading word too weak to beat the default ("be thorough" when the model is already thorough) with a stronger word.

#### Relevance

Check each line against what the document does. Delete a line that never bore on the task, including exposition and branches that belong behind a pointer. Delete a line that has gone stale as the world it describes changed.

Prune whenever the document is edited for another purpose. Adding is easier than removing, so stale layers accumulate over the live material until a reader cannot tell which lines still fire.
