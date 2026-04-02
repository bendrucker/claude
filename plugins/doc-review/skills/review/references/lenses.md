# Review Lenses

## Lens Catalog

| Lens | Agent | Description | Content Triggers |
|------|-------|-------------|-----------------|
| Style & Tone | `doc-review:style-tone` | Voice consistency, audience fit, AI trope detection | Always active |
| Technical Accuracy | `doc-review:technical-accuracy` | Factual correctness, API references, code correctness | Always active |
| Coherence & Structure | `doc-review:coherence-structure` | Logical flow, section ordering, transitions, redundancy | Always active |
| Example Code | `doc-review:example-code` | Code block correctness, idiomatic examples, imports | Document contains fenced code blocks (` ``` `) |
| Citations & Links | `doc-review:citations-links` | URL validity, source relevance, broken links | Document contains URLs or `[text](url)` links |
| Diagrams | `doc-review:diagrams` | Mermaid syntax validity, diagram accuracy vs text | Document contains ` ```mermaid ` blocks |
| Tables | `doc-review:tables` | Markdown table formatting, data consistency, alignment | Document contains markdown tables (`| ... |`) |

## Auto-Selection Rules

The orchestrator reads the document and activates lenses based on content triggers above. The first three lenses (style-tone, technical-accuracy, coherence-structure) always run. The remaining four are conditional.

To determine which conditional lenses apply, scan the document for:

- **Example Code**: Any fenced code block (triple backticks with or without a language identifier)
- **Citations & Links**: Any URL (`http://` or `https://`) or markdown link syntax
- **Diagrams**: A fenced code block with `mermaid` as the language identifier
- **Tables**: Lines matching the markdown table pattern (pipes separating columns with a header separator row)
