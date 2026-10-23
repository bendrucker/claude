/evals:design plugins/ops/skills/rollback-note plugins/ops/evals/rollback-note

The `rollback-note` skill already has a suite at `plugins/ops/evals/rollback-note/`, four cases that I wrote from incidents over a month. Every one is tagged `dev`. I have been climbing against them and they have started to fit the skill's wording, so extend the suite in place instead of starting a new one. Keep its existing cases and graders, and add what it lacks.

The skill handles two kinds of request, `rollback` and `hotfix`. The existing cases carry their kind in their tags. Tag every case you add, and any you retag, with its kind.

Corrections since I wrote those cases:

> user: announce that we rolled checkout back to 5.0.3
> assistant: What: checkout rolled back / Impact: some users / Next: investigate
> user: version in What, who and since when in Impact, and Next needs an owner

> user: write the hotfix note for web 7.1.4
> assistant: What: web 7.1.4 deployed / Impact: login errors since 09:10 UTC for EU users / Next: Dana to watch error rates
> user: it needs the commit that carries the fix

> user: tell the channel the db migration was reverted
> assistant: (a four-line note with a "Root cause:" line)
> user: three lines. Root cause goes in the postmortem
