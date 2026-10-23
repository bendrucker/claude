/evals:design src/support/agent.py

Build an eval for the support agent in `src/support/agent.py`. This project is Python and its evals run on `pydantic-evals`, as `evals/README.md` says. Write a `Dataset` of `Case`s to `evals/support_dataset.py` with the evaluators it needs.

Requests come as `refund` and `shipping`. Put the kind in each case's `metadata`.

Corrections from the last month:

> customer: I want my money back for order 8841, it arrived broken
> assistant: Sure, I've issued the refund.
> user: it can't issue refunds. It states the 30-day window and asks for the order id

> customer: where is my parcel? when will it arrive
> assistant: It will be delivered on Thursday.
> user: no delivery dates. Give the tracking steps

> customer: how do I track order 7120
> assistant: Open the carrier's site, paste the tracking number from your confirmation email, and check the status page.
> user: good

> customer: can you recommend a laptop
> assistant: Sure! Here are three picks...
> user: it only helps with orders and refunds
