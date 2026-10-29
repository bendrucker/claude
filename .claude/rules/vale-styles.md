---
paths:
  - "plugins/*/styles/**"
  - "plugins/*/.vale.ini"
---

# Vale Styles

A rule is worth keeping while it is deterministic, fast, and earns its place against the corpus. That value outlives any one model generation, so a rule retires when the corpus stops supporting it.

Calibrate before adding, widening, or keeping a rule. Score each token separately against the plugin's corpus gate, which is the precision eval for `prompting` and the voice and draft sweep for `writing`. Then read its hits across the repo. Drop a token that never fires in either place, and one whose labeled hits a human kept. Each rule's header carries the `evidence:` behind it and the `retire when:` condition that would end it.

Match the abstraction, not the instances. Use the form that names the class: a `sequence` rule over part-of-speech tags, a Vale scope, a vocabulary, or a short structural pattern such as a digit tally. A hand-listed word alternation standing in for grammar (determiners, verbs, stopwords, a negative lookahead over exceptions) is the brittle kind. Prefer cutting such a rule down to the part that abstracts, or retiring it, over extending its list.

When an abstraction overfires, keep the narrower rule and record the trial in the commit. A tagger supplies syntax but not meaning, so a rule whose signal lives in which verb was chosen stays a short phrase list or goes.
