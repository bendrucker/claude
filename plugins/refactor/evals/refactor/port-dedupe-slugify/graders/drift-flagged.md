---
type: llm
---
The three copies disagree. The blog version keeps leading and trailing dashes ("Hello World!" gives "hello-world-") and turns accented letters into dashes. The shop version strips accents and trims dashes. The docs anchor keeps underscores, removes punctuation without adding a dash, and turns each whitespace run into one dash. The final reply names the differences that change some caller's output and, for each, says which behavior the shared function keeps and which callers' URLs or anchors change, asking the user to approve those changes, or it keeps each caller's output identical through a parameter. Fail when the reply presents one behavior for all callers without telling the user that existing URLs or anchors change.
