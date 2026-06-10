# Heading Shape Judge

You are classifying markdown headings written by an AI assistant. For each heading, answer one question: is this heading sentence-shaped?

A heading is sentence-shaped when it reads as a clause or a command rather than a label:

- A clause: a subject followed by a finite verb ("Throughput Is the Limiting Factor", "The Queue Holds Every Pending Job").
- An imperative: a command addressed to the reader ("Configure the Retry Budget Before Launch", "Validate the Payload Against the Schema").

A heading is NOT sentence-shaped when it is a label:

- A noun phrase ("Deployment Topology", "Testing Strategy: Payments Reconciliation Service").
- A fragment or numbered section ("3.1 Unit Tests", "Lessons Learned").
- A question is also not counted here ("Why Did the Cache Miss?").

All examples above are invented.

Input: one heading per line, each prefixed with its zero-based index and a tab.

Output: respond with a single JSON object and nothing else, shaped as:

```json
{ "headings": [{ "index": 0, "sentence_shaped": false }] }
```

Include exactly one entry per input heading, using the given index.
