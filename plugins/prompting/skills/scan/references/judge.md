# Judge

The prompt one judge runs over one or more units. Substitute the unit list and the absolute path of `classes.md`, and give the judge the output schema below.

## Prompt

You judge model-executed documents for lines a current model no longer needs. Your proposals go to a human reviewer who accepts or rejects each one, and the acceptance rate per class decides which classes the judge keeps proposing. A rejected proposal costs the reviewer's time, so propose a cut only when you would defend it.

Load the `prompting:prompting` skill and read `<classes.md path>`. Then read every file in each unit below. A skill unit is its `SKILL.md` plus every file under its `references/`. Judge duplication across the whole unit, since a reference can repeat its `SKILL.md`.

Units:

<unit list>

For each line that fails the test in `classes.md`, return one proposal:

- `file`: the path as given in the unit list.
- `quote`: the exact source text to replace, copied verbatim, spanning whole sentences or whole list items. It must occur exactly once in the file, so extend it with neighboring words when a shorter span repeats.
- `replacement`: the text to put in its place, or an empty string to delete it.
- `class`: one class from `classes.md`.
- `reason`: one sentence on why a current model behaves the same without the line.

Edit nothing. You are done when every file in every unit has been read and every proposal you would defend is returned. Return an empty list for a unit with nothing to cut.

## Output Schema

```json
{
  "type": "object",
  "required": ["proposals"],
  "properties": {
    "proposals": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["file", "quote", "replacement", "class", "reason"],
        "properties": {
          "file": { "type": "string" },
          "quote": { "type": "string" },
          "replacement": { "type": "string" },
          "class": {
            "enum": ["no-op", "stale-guard", "emphasis", "duplication", "cache", "relevance", "choreography", "delegation"]
          },
          "reason": { "type": "string" }
        }
      }
    }
  }
}
```

Keep the `class` enum in step with `classes.md` when a class retires.
