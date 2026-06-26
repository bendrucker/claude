You are comparing two implementation plans written for the same request. Decide which plan is better, judged on the qualities below. The two plans are labeled A and B. You do not know which guidance produced either one. Judge only what is on the page.

## Qualities

- **Right-sized detail**: the plan confirms its direction before committing to file lists, line numbers, signatures, or test cases. It does not build elaborate detail around one unconfirmed approach. When more than one approach is viable, it surfaces the choice rather than presupposing one.
- **Outcome-focused**: the plan states the goal and the end state it is driving toward, with outcomes a reader could verify. It reads as a path to a result. A flat checklist of tasks with no stated end state is weaker.
- **Scope discipline**: the plan draws clear boundaries. It names what it is not doing and defers non-essential work instead of sprawling into everything adjacent.
- **Grounded**: the plan refers to the actual code and constraints it was given. It does not invent files, symbols, or structure with no basis in the request. Where it needs something it was not given, it says so rather than assuming.

## Request

{{REQUEST}}

## Plan A

{{PLAN_A}}

## Plan B

{{PLAN_B}}

## Output

Compare the two plans on each quality, then overall. A plan can win a quality, lose it, or tie. The overall verdict is your holistic preference, not a tally of the per-quality calls. Use `tie` only when the two are genuinely close on that dimension.

Judge the substance and disregard the form. Length is not quality: a longer plan, or one with more headings or extra labeled sections, is not better unless the added content makes one of the qualities above genuinely stronger. A section labeled "Alternatives" or "Out of scope" earns scope-discipline credit only when the boundary it draws is correct and not obvious. A section that restates the request, pads, or names a boundary no reader would have doubted is not a point in its favor. Reward a plan for drawing the right boundary, whether it does so in a dedicated section or in a sentence.

Return only a JSON object, no prose, in this exact shape:

```json
{
  "overall": "A|B|tie",
  "qualities": {
    "right_sized_detail": "A|B|tie",
    "outcome_focused": "A|B|tie",
    "scope_discipline": "A|B|tie",
    "grounded": "A|B|tie"
  },
  "rationale": "<one or two sentences naming the deciding difference>"
}
```
