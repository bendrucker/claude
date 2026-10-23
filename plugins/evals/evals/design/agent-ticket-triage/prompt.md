/evals:design plugins/desk/agents/ticket-triager.md

Write an eval suite for the `ticket-triager` agent at `plugins/desk/evals/ticket-triager/`, for `claude plugin eval`.

The agent labels one ticket with a queue and a priority. The requests I care about come as `bug` and `question`. Tag each case with its kind.

Corrections from the last two weeks:

> ticket: "Export button is a no-op since Tuesday, the whole finance team is blocked"
> assistant: queue: bug / priority: p2
> user: blocked means p1

> ticket: "Anyone can open /admin/export if they guess the URL, no login asked"
> assistant: queue: bug / priority: p1
> user: that's an access bypass. Security queue

> ticket: "Do you support SSO with Okta?"
> assistant: queue: sales / priority: p3
> user: there's no sales queue. Question

> ticket: "How do I change the date format on exports?"
> assistant: queue: question / priority: p3
> user: right
