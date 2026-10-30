---
paths:
  - "plugins/*/styles/**"
  - "plugins/*/.vale.ini"
---

# Vale Styles

A rule is worth keeping while it is deterministic, fast, and improves the text it flags. That value outlives any one model generation, so a rule retires when its hits stop reading worse than their rewrites.

Calibrate before adding, widening, or keeping a rule. Sample its hits from the session corpus and the voice baseline, and judge each in context: would the rewrite read better? Precision on that judgment decides the rule, for `prompting` through its precision eval. A rule that flags the user's own writing still ships when the flagged spans read worse, because the user wants some patterns gone from their writing too. Lift, the model rate over the baseline rate, only ranks which candidates to judge first. Then read the rule's hits across the repo. Drop a token that never fires, and one whose judged hits mostly read fine. Each rule's header carries the `evidence:` behind it and a `retire when:` condition stated against judged precision or a dead pattern, never against a rate falling to the voice baseline.

Match the abstraction, not the instances. Use the form that names the class: a `sequence` rule over part-of-speech tags, a Vale scope, a vocabulary, or a short structural pattern such as a digit tally. A hand-listed word alternation standing in for grammar (determiners, verbs, stopwords, a negative lookahead over exceptions) is the brittle kind. Prefer cutting such a rule down to the part that abstracts, or retiring it, over extending its list.

When an abstraction overfires, keep the narrower rule and record the trial in the commit. A tagger supplies syntax but not meaning, so a rule whose signal lives in which verb was chosen stays a short phrase list or goes.
