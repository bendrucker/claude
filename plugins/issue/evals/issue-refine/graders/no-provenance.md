---
type: regex
pattern: '<issue>(?:(?!</issue>)[\s\S])*?(?:no code was (?:re-?)?read|not (?:yet )?verified against|verify (?:each|these|every) (?:symbol|path)|taken from the (?:prior |reporter|planning|session)|from the reporter''s|gathered (?:on [\d-]+ )?from the (?:session|notes|reporter|planning)|working assumption|no commit sha)'
flags: i
match: not_contains
---
The issue states facts without narrating where they came from or disclaiming what the drafter didn't check.
