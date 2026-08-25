---
name: write-discoverable-code
description: >-
  Use when naming or renaming a function, type, constant, or file, when a name is
  too generic to grep uniquely, when one concept is spelled two ways, or when a
  behavior change leaves a stale name. Rules for names an agent finds by grepping.
---

# Write Discoverable Code

Every identifier is a search query someone runs later. Word count carries these rules in any language: `queue_event_for_dispatch`, `queueEventForDispatch`, and `QueueEventForDispatch` are all three words.

## Name Length

Give every exported symbol two to four words, at least one of them a domain word. A domain word names something this codebase is about. Mechanisms like `parse` and `client` do not count. `diff` becomes `diffUserObjects`.

Grep the candidate first and take the shortest name in that range with no unrelated hits. The two-word floor holds even when one word greps uniquely today.

## Generic Verbs

Attach the thing acted on to the verb: `sanitize` becomes `sanitizeEmailHtml`. The common cases are `process`, `handle`, `run`, `validate`, and `sanitize`. Qualify only as far as uniqueness requires.

## Definition Sites

Keep one definition site per symbol. When a helper is needed elsewhere, move it, delete the original in the same change, and import it everywhere else.

## Module Paths

Put the qualifying context in the symbol rather than the directory holding it. A module at `users/diff` exports `diffUserObjects`.

A rigid repo-wide convention is the exception: every contract module exporting `Input` and `Output`.

## Vocabulary

Pick one spelling per concept and use it everywhere, `organizationId` or `orgId`. Search the codebase before coining a word and reuse what is there.

## Stale Names

Rename in the same commit that changes the behavior. Visibility markers count: a `_private` helper another module now imports gets a public name in the commit that adds the caller.

## Filenames

Name a file after the domain it holds, with the same two-to-four-word treatment a symbol gets. `billing-plan-config` rather than `config`. A file needs its own domain word even when every symbol inside it is already qualified. Replace `types`, `utils`, `helpers`, and `handlers`. An entry point named by convention is fine when it only re-exports.

## Done

Every name added or changed in this session satisfies every rule above, and every renamed symbol is gone from where it came from.

Adapted from `home/.agents/skills/write-discoverable-code/SKILL.md` in dmmulroy/.dotfiles at a6d5117, MIT.
