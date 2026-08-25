# Levers

Three things that change what an agent does with a document: how each unit of work ends, which words anchor its behavior, and what gets removed. Companion to [information-hierarchy.md](information-hierarchy.md), which covers where material sits.

## Completion Criteria

Every unit of work ends on a completion criterion, the condition that tells the agent it is done. Two properties make it a lever.

#### Clarity

Can the agent tell done from not-done? A vague bound such as "understanding reached" invites premature completion: ending the work before it is genuinely finished, attention already sliding toward being done. The visible work still ahead supplies the pull. The criterion's clarity supplies the resistance.

Sharpen the bound first. That fix is local and cheap. Only when the bound is irreducibly fuzzy and you have watched the agent rush it should you split the sequence to hide what follows, and that split works only across a real context break (see Splitting in [information-hierarchy.md](information-hierarchy.md)).

#### Demand

How much the criterion requires. "Every modified model accounted for" forces thorough work where "produce a change list" lets the agent stop at three items. Demand drives the digging the agent does inside the work, latent in the wording rather than spelled out as its own instruction.

Demand is not step-bound. "Every rule applied" binds a body of flat reference the same way "every step done" binds a sequence, which is how an all-reference document still carries an exhaustiveness bar. State the observable done-state, and the agent keeps its freedom over how to reach it.

The strongest criteria are both checkable and exhaustive.

## Leading Words

A leading word is a compact concept already living in the model's pretraining that the agent thinks with while running the document. Repeated as a token and never as a sentence, it accumulates a distributed definition across the places it appears and anchors a whole region of behavior in a handful of tokens, because it recruits priors the model already holds.

`LANGUAGE.md` in `improve-codebase-architecture` is this technique at full size: seam, depth, adapter, locality. Each word carries a paragraph of meaning that never has to be restated at the call site.

Coining your own word works when you define it clearly, but an invented word recruits nothing. You pay in definition tokens what a pretrained word gives away. Look for an existing word first.

A leading word anchors twice. In the body it anchors execution: the agent applies the same behavior every time the word appears, and inside flat reference the word focuses attention on a class of thing to look for. In a pointer it anchors invocation: when the same word appears in prompts, in docs, and in the code, the agent links that shared language to the material and reaches it more reliably.

Hunt for passages that collapse into one token. A triad spelled out at three sites. A pointer spending a sentence gesturing at one idea.

- "fast, deterministic, low-overhead" collapses to *tight*, as in a tight loop.
- "a loop you believe in" collapses to *red*, turning a fuzzy gate into a binary state the agent can observe. The loop goes red on the bug or it does not.

Assume any document you inherit is carrying restatements that a leading word retires. Go find them.

#### The Positive Form

Steering by prohibition drags the forbidden behavior into context and makes it more available. Say *don't think of an elephant* and the elephant is all there is. The negation is a weak modifier that the strongly activated concept runs straight over, so the ban half-reads as an instruction.

State the target behavior instead, so the banned one is never spoken. "Write one-line comments" beats a rule against long ones. A prohibition earns a place only as a hard guardrail with no positive phrasing available, and even then it should carry the positive target beside it so attention lands on what to do.

## Pruning

#### Single Source of Truth

Keep each meaning in one authoritative place, so changing the behavior is a one-place edit. The same meaning in two places costs maintenance and tokens, and it inflates that meaning's apparent rank on the hierarchy past its real one. This is the accidental inverse of a leading word, which repeats a token on purpose and the meaning never.

#### Cache and Environment

The environment is a source of truth too: `package.json` scripts, config files, the directory layout, `--help` output. A document that restates it is a cache, a copy of a lookup, earning its load only when the lookup is expensive.

Cache what the agent cannot find by looking: the unwritten convention, the reason behind a choice, the gotcha no config confesses. Leave one-file and one-command lookups to the environment, where they cannot go stale. `herdr`'s skill states that `--help` enumerates every enum flag, which retires every flag table that would otherwise have to be maintained beside it.

#### No-ops

Hunt sentence by sentence for instructions the model already obeys by default. Each one pays load to say nothing.

The test is model-relative rather than reader-relative: does this line change behavior against the default? Two people disagreeing about a no-op are disagreeing about the default, and they settle it by running the document rather than by arguing. When a sentence fails the test, delete the whole sentence rather than trimming words from it.

The test grades leading words too. A word too weak to beat the default, such as *be thorough* when the agent is already thorough-ish, is a no-op. The fix is a stronger word, not a different technique.

#### Sediment

Check every line for relevance: does it still bear on what the document does? A line loses relevance by never bearing on the task, which covers exposition and branches that should have been disclosed, or by going stale as the world it describes moves.

Without a pruning discipline, the default outcome is sediment: stale layers that settle because adding feels safe and removing feels risky, until finding what is still live means coring down through them. Shorter documents stay relevant more easily. This is the same discipline the repo's curation rule applies to skills, hooks, and wordlist entries, one level down.
