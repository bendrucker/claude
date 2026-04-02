# Synthesis Guidelines

## Merging Findings

When multiple lenses flag the same issue, keep the most specific finding and drop duplicates. Prefer the lens whose expertise is most relevant (e.g., a code correctness issue found by both technical-accuracy and example-code should be attributed to example-code).

## Severity Ranking

Present findings in order of severity:

#### Blocking
Issues that make the document incorrect or misleading. Must be fixed before publishing.
- Factual errors, broken code examples, invalid links to critical resources, contradictions between sections

#### Important
Issues that significantly reduce document quality. Should be fixed.
- Inconsistent terminology, missing context for the target audience, structural gaps, unclear diagrams

#### Suggestions
Improvements that would polish the document. Nice to have.
- Tone adjustments, minor formatting issues, optional restructuring, additional examples

## Deduplication

Compare findings across lenses before presenting. Two findings are duplicates when they:
- Reference the same line or section of the document
- Describe the same underlying problem (even if using different words)
- Would be resolved by the same edit

When deduplicating, preserve the more detailed description and note which lenses independently flagged it.

## Presentation Format

Group findings by severity, not by lens. Within each severity level, order by document position (top to bottom). For each finding, include:

- The section or line reference
- The issue description
- A suggested fix (when straightforward)
- Which lens(es) identified it

## Writing Style

Apply the user's writing preferences when drafting the synthesis. Avoid AI tropes: no em dashes, no filler vocabulary, no promotional language. Be direct and specific.
