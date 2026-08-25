# Levers

What changes an agent's behavior in a document: how each unit of work ends, which words anchor the behavior, and what gets removed. Companion to [information-hierarchy.md](information-hierarchy.md), which covers where material sits.

## Completion Criteria

End every unit of work on a completion criterion: the condition that tells the agent the work is done. Two properties make it a lever.

#### Clarity

Write a criterion the agent can check. A vague bound such as "understanding reached" lets the agent stop before the work is finished, because visible remaining work pulls toward finishing the current one.

Sharpen the bound first, since that fix is local and cheap. Split the sequence to hide later work only when the bound cannot be sharpened and you have observed the agent stopping early. That split works only across a real context break (see Splitting in [information-hierarchy.md](information-hierarchy.md)).

#### Demand

Write a criterion that requires the work you want. "Every modified model accounted for" forces a full pass where "produce a change list" lets the agent stop at three items. Demand drives the digging the agent does inside the work, without naming that digging as its own instruction.

Demand does not require steps. "Every rule applied" bounds a body of flat reference the same way "every step done" bounds a sequence, so an all-reference document can carry an exhaustiveness bar.

Make criteria both checkable and exhaustive.

## Leading Words

A leading word is a compact concept from the model's pretraining, used as a repeated token rather than restated as a sentence. It accumulates a definition across the places it appears and anchors a region of behavior in few tokens, because the model already holds the priors.

`LANGUAGE.md` in `improve-codebase-architecture` uses this at full size: seam, depth, adapter, locality. Each word carries a paragraph of meaning that the call site never restates.

Choose an existing word before coining one. A coined word works when the document defines it clearly, but it recruits no priors, so you pay in definition tokens what a pretrained word supplies free.

A leading word anchors in two places. In the body it anchors execution: the same word produces the same behavior at each appearance, and inside flat reference it names the class of thing to look for. In a pointer it anchors invocation: when prompts, docs, and code share the word, the agent links them to the material and reaches it more reliably.

Look for passages that collapse into one token, such as a triad spelled out at three sites or a pointer spending a sentence on one idea:

- "fast, deterministic, low-overhead" collapses to *tight*, as in a tight loop.
- "a loop you believe in" collapses to *red*: the loop goes red on the bug or it does not.

A leading word is a domain term, so it survives the conversion in [plain-language.md](plain-language.md). A metaphor used once for emphasis does not.

#### Positive Form

State the target behavior. A prohibition puts the forbidden behavior in context and makes it more available, and the negation is a weak modifier against the activated concept, so the ban partly reads as an instruction to perform it.

"Write one-line comments" beats a rule against long ones. Use an explicit ban only as a hard guardrail with no positive phrasing available, and pair it with the positive target.

## Pruning

#### Single Source of Truth

Keep each meaning in one place, so changing the behavior is a one-place edit. The same meaning in two places costs maintenance and tokens, and it raises that meaning's apparent rank on the ladder above its real one. A leading word is the deliberate inverse, repeating a token and never the meaning.

#### Cache and Environment

The environment is a source of truth: `package.json` scripts, config files, the directory layout, `--help` output. A document restating it is a cache of a lookup, and it earns its load only when the lookup is expensive.

Cache what the agent cannot find by looking: the unwritten convention, the reason behind a choice, the gotcha no config records. Leave one-file and one-command lookups to the environment, where they cannot go stale. The `herdr` skill states that `--help` enumerates every enum flag, which retires the flag tables that would otherwise be maintained beside it.

#### No-ops

Delete instructions the model already follows by default.

Test each sentence against the model's default rather than a reader's expectation: does this line change behavior? Two people disagreeing about a no-op are disagreeing about the default, and they settle it by running the document. When a sentence fails, delete the whole sentence instead of trimming words from it.

The test also grades leading words. A word too weak to beat the default, such as "be thorough" when the agent is already thorough, is a no-op. Replace it with a stronger word.

#### Sediment

Check each line for relevance: does it still bear on what the document does? A line loses relevance by never bearing on the task, which covers exposition and branches that should be disclosed, or by going stale as the world it describes changes.

Without a pruning pass, stale layers accumulate, because adding feels safe and removing feels risky. Shorter documents stay current more easily. This is the repo's curation rule applied one level down, to lines instead of to skills.
