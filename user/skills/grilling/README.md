# Grilling

Vendored from [mattpocock/skills](https://github.com/mattpocock/skills/blob/1495d01/skills/productivity/grilling/SKILL.md) at [`1495d01`](https://github.com/mattpocock/skills/commit/1495d01). The design tree, the frontier, the round discipline, and "finding facts is your job" are upstream's. The interview runs through `AskUserQuestion` instead of upstream's `❓ **Q1**` / `➡️` markdown convention, which is why the option and answer-reading rules below exist at all.

Question shape comes from [`../ask/SKILL.md`](../ask/SKILL.md), bang-injected at load time so there is one copy. The `grep` takes the rule bullets and leaves `ask`'s framing sentence behind, since grilling has no preceding prose to convert. Reformatting `ask` away from bullets, or moving it, drops the injection to a one-line fallback rather than silently emitting nothing. Nothing in `SKILL.md` restates an injected rule, so the sections there cover only what rounds add: ordering questions across rounds, option counts, and how to read an answer that rejects its own framing.

## Calibration

The option and answer-reading rules were fit to 1,315 `AskUserQuestion` calls (2,398 individual questions) across 757 sessions in the local session index:

- Custom answers rise with option count: 18.3% at two options, 22.3% at three, 43.3% at four. Three calls errored outright on five or more.
- A `(Recommended)` label lifts the pick rate from 59.9% (the first-option baseline) to 75.6%.
- Half of calls (50.7%) batch two to four questions, and individual questions get overridden inside a batch rather than the batch getting rejected whole.
- 4.2% of calls were rejected outright, which is the whole batch declined. Separately, 4.3% of answers came back `(no option selected) notes: ...`, which is one question overridden inside a batch that was otherwise answered normally.
- Multi-select answers come back restructured (`"Do #1 + #2 in the MR, file #3-#6 as Linear issues"`) far more than ticked.

The close section's escalation contract copies a shape from plan documents written by hand outside this repo: pre-authorize execution that matches what was agreed, stop on irreversible steps and on unknowns the approach rests on. No template for it lives here.

Two things deliberately left out. There is no section on preventing "you should have asked" complaints, because the corpus contains no instance of one. There is no rule against confirmation-seeking in general, because the pushback sample ("just do it", "you rebase and figure it out!!!") is small and fires only on mechanical or already-stated work.

## Removal

Model-invocable as an experiment, against the usual preference for `disable-model-invocation` on personal skills. The evidence is the split between slash entry and Skill-tool entry for `grilling` in the session index, which `plugins/claude-code/skills/session/resources/queries/skill-auto-vs-explicit.sql` already computes per skill. No Skill-tool entries after roughly four weeks means the natural-language triggers are inert and the recurring catalog cost buys nothing, so the skill goes to `disable-model-invocation: true`.
