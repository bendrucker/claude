---
type: regex
pattern: '^(?=[^\n]*(?:re-?profil|cold[^\n]{0,60}profil|profil\w*[^\n]{0,80}(cold|empty|clean|fresh|without (the |a )?cache|no cache|cleared|ci-build|harness|\bCI\b)|(clear|empty|delete|remove|wipe|reset)\w*[^\n]{0,60}cache[^\n]{0,80}(profil|trace)|new profile|profile (it |the build )?again))'
flags: im
match: contains
---
The next measurement profiles the CI scenario itself: a build from an empty cache, through the harness.
