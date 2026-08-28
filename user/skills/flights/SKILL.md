---
name: flights
description: >-
  Search flights from a natural-language request, using Google Flights for
  market context and united.com for what United will actually sell. Compares
  cash against miles, explores flexible date and routing shapes, and reports a
  ranked shortlist with deep links. Reads only. Never books. Use via /flights.
argument-hint: "[<the trip, in plain language>]"
disable-model-invocation: true
allowed-tools:
  - AskUserQuestion
  - Bash(cat ~/.config/claude-flights/*)
  - Bash(agent-browser:*)
  - Bash(bun:*)
  - Read
  - Write
---

# Flights

Search flights the way I actually decide: fully loaded prices, real departure times, and a shortlist short enough to act on.

Preferences: !`cat ~/.config/claude-flights/config.json 2>/dev/null || echo '{}'`

If that came back `{}`, the config is missing. Run the search on what the request states, then offer to write a starter config at the end. Its shape:

```json
{
  "home": { "primary": "LAX", "metro": ["LAX", "BUR", "LGB"] },
  "loyalty": { "carrier": "UA", "program": "MileagePlus", "status": "none" },
  "miles": { "centsPerPointThreshold": 1.5 },
  "filters": {
    "hard": ["no Basic Economy", "no red-eyes", "no 2+ stop itineraries"],
    "soft": ["prefer nonstop", "avoid arrivals after midnight"]
  },
  "cabin": { "default": "economy" },
  "preferences": [
    "Aircraft type matters. Say which one every row is.",
    "Take Economy Plus when the fare gap is under $40.",
    "Show a few real options, not one pick."
  ]
}
```

`preferences` is prose, read and applied per search rather than scored. Every key is optional, and any object may carry a `note` string for context that does not fit the field.

`cabin.default` names a search cabin, one of `economy`, `premium`, `business`, or `first`, and passes straight to `--cabin`. Economy Plus is a United seat product rather than a search cabin, so a preference for it belongs in `preferences` and gets read off the results.

## Boundaries

These are absolute. They do not bend because a page makes the next step convenient.

- Read as far as **fare selection and view-only seat maps**. Stop there.
- Never enter passenger or payment details. Never click `Purchase`, `Confirm`, `Hold`, or `FareLock`. Never spend miles or money.
- On united.com the seat **fee** sits behind the Traveler Info step. That step is past the boundary. Report the fee as unavailable rather than crossing it.
- Never type a password. Open headed and hand over the keyboard.
- Report a bot challenge and stop. Do not work around one.
- Report the award price shown. Never read or assume an account balance.

## Intake

Ask before searching only what changes the search, and only what the request and config leave open. One `AskUserQuestion` round, not an interview.

- **Baggage.** A bike changes the airline, the aircraft, and sometimes the airport. Skis and oversized cases do the same. Ask when the trip's purpose suggests gear.
- **Ground plan at each end.** Whether transit works, or someone is driving, decides how much an inconvenient airport actually costs.
- **Who is paying**, when the answer changes whether miles are on the table.
- **Shape**, when the request implies flexibility without pinning it down. Enumerate the shapes to compare rather than guessing one.

Skip the round when the request already answers these.

## Search

Cheap pass first, expensive pass second.

### Google Flights

Run every shape here. It is fast, needs no login, and gives market context across carriers.

For flexible dates, open the **Date grid** first. It prices a whole window of date pairs in one page load, which answers "is there a better fare a day either side" without a query per date. Use it to pick the shortlist, then price those dates properly.

Where the grid does not reach, a round trip still decomposes: the cheapest round trip equals the cheapest outbound one-way plus the cheapest return one-way, verified to within a dollar. So N departure dates against M return dates costs `N + M` queries, not `N × M`.

### united.com

Run the shortlist only. It is slow and needs a login, but it is the only truth for what United will sell, and the only source for award pricing. Use it on the handful of shapes that survived the Google pass.

See [`references/google-flights.md`](references/google-flights.md) and [`references/united.md`](references/united.md) for the mechanics. Both encode gotchas that cost real debugging time. Read the relevant one before driving that site.

Bound the work. Say up front how many queries the plan needs, and if a shape gets dropped for budget, say which and why, so the coverage stated matches the coverage run.

## Filters

Hard filters come from `filters.hard`, defaulting to Basic Economy, red-eyes, and two or more stops. The parser marks the first two and drops them on request, so let the tool apply those rather than filtering by eye. The reference gives the flags.

Stop count has no flag. Build it into the search instead: omit `--stops` and the URL asks Google for nonstops only. Where connections are wanted, read the stop count off the `Stops` column.

Soft, shown but marked down: tight connections, arrivals near midnight, departures needing a pre-dawn wake-up.

Nearby dates are worth a look. Flag a win within a day of the requested date, but do not silently move the trip.

## Pricing

Quote the **fully loaded** price by default: what actually gets paid, seat included, not a headline fare that gets topped up later.

Break the seat out as its own line so the base fare and the upgrade stay separately visible. Some trips split who pays which part.

For cash against miles, compute cents per point:

```
cpp = (cash_fare - award_taxes) / miles * 100
```

Compare that against `miles.centsPerPointThreshold`, defaulting to 1.5 if unset. Report cash, miles, and cpp for every option regardless of which one wins, and say which the arithmetic favors. A saver award is worth calling out by name, because saver space is scarce and dynamic pricing usually lands well below the threshold.

## Output

A terminal table, then one line of recommendation. Include the search URL each table came from, so a row can be re-found. There is no per-itinerary link to hand over, so do not describe one as if there were.

Columns that earn their place: departure and arrival with the day, duration, stops, flight number, aircraft, and the fully loaded price. Aircraft matters for cabin and wifi, so keep it.

Rank on the config's prose preferences, judged per search. Do not reduce them to a scoring formula. When two options are genuinely close, say so and give the tradeoff rather than manufacturing a winner.

Where Google and united.com disagree on a United flight, united.com wins and the gap gets flagged.

## Recovery

Retry once. Then degrade to a narrower search. Then report which step failed and what was collected before it did. A partial answer with its gap named beats a confident guess.
