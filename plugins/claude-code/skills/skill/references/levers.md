# Levers

## Completion Criteria

End every unit of work on a completion criterion: the condition that tells the agent the work is done.

#### Clarity

Write a criterion the agent can check. A vague bound such as "understanding reached" lets the agent stop early.

Sharpen the bound first. Split the sequence to hide later work only when the bound cannot be sharpened and you have observed the agent stopping early. That split works only across a real context break (see Splitting in [information-hierarchy.md](information-hierarchy.md)).

#### Demand

Write a criterion that requires the work you want. "Every modified model accounted for" forces a full pass. "Produce a change list" lets the agent stop at three items.

Demand does not require steps. "Every rule applied" bounds a flat reference document the same way "every step done" bounds a sequence.

## Leading Words

A leading word is a compact concept from the model's pretraining, reused as the same token instead of restated as a sentence. `LANGUAGE.md` in `improve-codebase-architecture` runs on four of them: seam, depth, adapter, locality.

Choose an existing word before coining one. A coined word works only when the document defines it clearly.

In the body, the same word produces the same behavior at each appearance, and inside flat reference it names the class of thing to look for. In a pointer, share the word across prompts, docs, and code so the agent links them to the material.

Look for passages that collapse into one token:

- "fast, deterministic, low-overhead" collapses to *tight*, as in a tight loop.
- "a loop you believe in" collapses to *red*: the loop goes red on the bug or it does not.

A leading word is a domain term, so keep it through the plain-language conversion. Convert a metaphor used once for emphasis to its literal fact instead.

#### Positive Form

State the target behavior. "Write one-line comments" beats a rule against long ones. Use an explicit ban only as a hard guardrail with no positive phrasing available, and pair it with the positive target.

## Pruning

#### Duplication

Keep each meaning in one place. A leading word is the deliberate exception: it repeats a token, never the meaning.

#### Cache

The environment is a source of truth: `package.json` scripts, config files, the directory layout, `--help` output. A document restating it is a cache, and earns its place only when the lookup is expensive. The `herdr:herdr` skill states that `--help` enumerates every enum flag, which retires the flag tables that would otherwise sit beside it.

Cache what the agent cannot find by looking: the unwritten convention, the reason behind a choice, the gotcha no config records. Leave one-file and one-command lookups to the environment.

#### No-ops

Delete instructions the model already follows by default. Test each sentence against the model's default, not a reader's expectation: does this line change behavior? Settle a disagreement by running the document. When a sentence fails, delete the whole sentence instead of trimming it.

Replace a leading word too weak to beat the default ("be thorough" when the agent is already thorough) with a stronger word.

#### Relevance

Check each line against what the document does. Delete a line that never bore on the task, including exposition and branches that belong behind a pointer. Delete a line that has gone stale as the world it describes changed.
