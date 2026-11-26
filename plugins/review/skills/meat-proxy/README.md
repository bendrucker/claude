# Meat Proxy

Draft a reply that hands an AI-relayed PR, MR, or doc back to its author, with questions only the author can answer.

The name comes from Niklas Gruhn's [Don't be a meat proxy](https://gruhn.me/blog/2026-08-03/).

## Usage

```
/review:meat-proxy <target> [instructions]
```

The target is a PR or MR URL, a doc link, or pasted text. Instructions are optional: a gut call about what's wrong, questions to answer in the private notes, or sources to read such as a ticket or an earlier review.

The skill prints the draft and private notes in chat. It posts only when told to, and then stages the draft unpublished: a GitLab draft note or a pending GitHub review. Each target keeps a state file under `${CLAUDE_PLUGIN_DATA}/meat-proxy/`, so a second run on the same target is a follow-up round.

## Contents

- `SKILL.md` - Skill definition
