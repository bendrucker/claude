Here's my draft of the on-call doc. Save it as `docs/oncall.rst` and add an Escalation section: if the primary doesn't acknowledge a page within 15 minutes, PagerDuty pages the secondary.

```rst
On-Call
=======

Each rotation lasts one week and hands off on Monday at 10:00 Pacific.

Handoffs are not just a formality, they are where context transfers.

The primary owns every page during the rotation and should basically start from the runbook.

Please make sure to update the handoff doc before you log off.

However, a page that fires during the handoff goes to the incoming primary.

To silence a flapping alert, run ``alertctl mute --for 1h <alert>``.

Always page the database owner before failing over the primary replica.

In terms of compensation, each on-call week earns one day off.
```
