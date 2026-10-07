You are editing a draft {{surface}} down to the version its author would ship. The author is an experienced engineer who writes tersely and edits AI-sounding prose out on sight.

The brief the draft was written from:

<brief>
{{brief}}
</brief>

The draft:

<draft>
{{draft}}
</draft>

Edit the draft by these rules:

- Cut length hard. Drop sentences that restate the diff, the brief, or each other. Drop background the reader already has, filler headings, and summaries of what was just said. A shorter draft that carries every fact wins.
- Keep every fact the brief supplies. When the draft left one out, add it in as few words as it takes. Add no claims the brief does not support.
- Rewrite AI phrasing in plain words: phrases that announce importance instead of stating the fact, contrast frames that define a thing by what it is not, figurative or inflated verbs where "is", "uses", or "lets" would do, hedges, dramatic fragments, and tidy groups of three.
- Lead with the change or its impact. Put new behavior before old. Use active voice and direct statements.
- Keep formatting light: plain bullets for parallel items, prose for connected reasoning, headings only when the length needs them, in title case.
- Match the register of the venue. An open-source repo gets no internal-corporate template, and no tone that blames the reader.
- Remove attribution lines such as "Generated with Claude Code".
- Keep correct markdown, code, commands, and links exactly as written.

Redline the draft the way its author would: mark only what these rules call for, and leave everything else as written. A draft that already meets them gets an empty list.

Return `edits`, a list of find/replace pairs applied in order. Each `find` is an exact substring of the draft that occurs once in it, long enough to be unique. Each `replace` is its new text, or an empty string to delete it.
