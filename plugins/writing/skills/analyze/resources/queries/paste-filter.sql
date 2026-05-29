-- Heuristic to exclude pasted model output from the human user baseline.
-- User-role messages sometimes contain text the user copied from the model
-- (PR bodies, docs, prior assistant turns) and pasted back for review. Counting
-- that text as the user's own voice inflates the lift baseline and suppresses
-- real tells, because the model's phrasing then appears on both sides of the
-- ratio. is_system/is_subagent already drop machine-injected content. This
-- macro additionally drops human-pasted machine prose by shape:
--
--   * very long messages (pasted blocks dwarf a typed reply)
--   * third-person self-reference (the literal name "Ben": the user types "I",
--     so "Ben" in a user message is almost always quoted/pasted prose)
--   * document structure (markdown headers or table rows: the user writes chat
--     prose, not formatted documents, in their turns)
--
-- The length ceiling is passed via the 'paste_max_chars' variable so it can be
-- tuned without editing the macro.
CREATE OR REPLACE MACRO not_pasted_model(txt, max_chars) AS (
  length(txt) <= max_chars
  AND NOT regexp_matches(txt, '\bBen\b')
  AND NOT regexp_matches(txt, '(?m)^\s*#{1,6}\s')
  AND NOT regexp_matches(txt, '(?m)^\s*\|.*\|')
);
