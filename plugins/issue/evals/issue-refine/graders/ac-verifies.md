---
type: llm
---
Read only the issue between the <issue> lines, above any "Agent Context" heading. Requirements say what must be true when the work is done. Acceptance criteria verify it: each criterion names a concrete check an agent or reviewer can run (an action or input, and the result to observe), so someone can tell whether the work is finished. A criterion that restates a requirement in other words ("The export respects filters" under a requirement saying the same) fails, and so does one with no observable result. An issue with no acceptance criteria passes. For example, the requirement "Exports respect the current filters" pairs with the criterion "Filter the report to one region, export, and the CSV holds only that region's rows".
