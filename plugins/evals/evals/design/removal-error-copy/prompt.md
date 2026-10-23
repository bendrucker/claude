/evals:design plugins/copy/skills/error-copy

Write an eval suite for the `error-copy` skill at `plugins/copy/evals/error-copy/`, for `claude plugin eval`.

I am about to delete the last bullet of the skill, the one that tells it to open with an apology. Support says the apologies bury the failure. The suite has to show that the opening apology is gone after the edit. The rest of the skill must keep working, so it also has to catch a rewrite that loses anything the other bullets require.

Requests come as `rewrite` (tighten an existing error string) and `fresh` (write one from a description). Tag each case with its kind.

What users and support said:

> user: reword "The upload could not be completed because the storage quota was exceeded (E-4012)"
> assistant: `Sorry, your upload didn't finish because your storage is full. Free up space and retry. (E-4012)`
> support: "Sorry" is noise here. Say what failed

> user: write an error for when the export times out, code E-5031
> assistant: `Oops! The export took too long. Try a smaller date range. (E-5031)`
> support: drop the Oops

> user: write an error for an expired invite link, code E-2208
> assistant: `This invite link has expired. Ask the sender for a new one. (E-2208)`
> support: this one is right

> user: reword "Payment declined"
> assistant: `Your card was declined. Use a different card to pay. (E-3101)`
> support: the code must stay at the end, this one is right
