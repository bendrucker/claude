# united.com

The only source for what United will actually sell, and the only source for award pricing. Slow, authenticated, and full of traps that look like correct answers.

## Browser Invocation

united.com returns `ERR_HTTP2_PROTOCOL_ERROR` under most agent-browser configurations. One combination works often enough to use:

```bash
agent-browser --session flights-united --profile Default --headed --idle-timeout 0 <command>
```

Rules that follow from this, all of them load-bearing:

- **Pass the identical full flag set on every call.** The flags are part of the browser's identity. Dropping `--profile` or `--headed` on a follow-up addresses a different browser, which comes back sitting on `about:blank`.
- **`--profile Default`**, the real Chrome profile. A dedicated profile directory fails intermittently. The mechanism is unexplained. It is worked around empirically, not understood.
- **Headless never works.** Headed only.
- **Chain `open`, a sleep, and `read` in one Bash call.** Splitting them across calls invites the daemon to reset between them.
- Allow 12 to 14 seconds after `open`. Results render late, and a page that returns the site shell with no itineraries usually needs more time rather than a different approach.

Even on the working combination the error recurs, including mid-session after a run of successful loads. It is a rate of use the site tolerates, not a configuration that fixes anything. Space the queries out, keep united.com to the shortlist, and when the error appears twice in a row, stop and report rather than continuing to retry. Results already collected stay valid.

Password entry is the user's. Open headed, hand over the keyboard, and wait.

1Password autofill kills the daemon. Avoid triggering it during a run.

## URLs

Build them. Do not drive the search form.

```
https://www.united.com/en/us/fsr/choose-flights
  ?f=<ORIG>&t=<DEST>&d=<YYYY-MM-DD>
  &tt=1&at=0&sc=7&px=1
  &taxng=1&newHP=True&clm=7&st=bestmatches&tqp=A
```

- `f`, `t`, `d` are origin, destination, and `YYYY-MM-DD`.
- **`at=1` switches the results from dollars to miles.** `at=0` gives cash. This single parameter is the whole award search.
- `tt=1` is one-way. One-way queries are the right unit here, matching the decomposition described in the skill.
- `px` is passenger count.

`awardSearchUrl()` in `scripts/united.ts` builds the award form.

## The Basic-versus-Standard Trap

**The "From" price on the results grid is frequently Basic Economy, and the grid never labels it.**

Observed on a transcontinental route:

| Cabin column | Grid says | Actually |
|---|---|---|
| United Economy | `$219` | Basic Economy. Standard is `$274` |

The Standard fare matched Google's number exactly. The grid did not.

Worse, this is inconsistent. On another date in the same market, one flight offered no Basic at all, so its grid price *was* Standard.

There is no way to tell from the grid which case applies. **Open the fare ladder.** Click the cabin button and read the expanded options:

```
Fare option 1 of 3
United Economy®
Basic (Most restrictive)
$219
...
Fare option 2 of 3
United Economy®
Standard
$274
```

Basic is identifiable by the label `Basic (Most restrictive)` and by its restriction list, which includes `No carry-on bags` and `No upgrades`. It is sometimes rendered `[disabled]` in the accessibility snapshot.

## Economy Plus Pricing

Economy Plus has no Basic tier, so **its fare price is already the fully loaded economy-with-legroom number.** No ladder click needed, no Basic ambiguity.

Its ladder holds only Standard and Flexible:

```
Fare option 1 of 2
Economy Plus
Standard
$470
- Extra legroom
```

On one transcontinental route the Economy Plus Standard fare ran a flat premium over Economy Standard, holding across several flights, two dates, and three aircraft types. A stable per-leg premium is worth sanity-checking against, but it is a route-level pattern rather than a constant.

## The Seat Fee

Two distinct things get called "Economy Plus":

- The **fare**, which bundles the seat. Visible on the results grid. Quotable.
- The **seat fee**, paid on top of a Standard fare at seat selection. Usually cheaper than the fare delta.

The seat fee appears only *after* the Traveler Info step, which is past the skill's boundary. Selecting a fare lands on Traveler Info, not on a seat map.

The pre-purchase seat map is reachable from the grid's per-flight `Seats` button and is **view-only with no prices at all**:

```
This seat map is for viewing only. You'll select your seat at a later time.
```

It is still worth opening for exit rows, which it labels precisely:

```
Row 20 - Wing exit row, 6 of 6 seats available
Row 22 - Wing exit row, 4 of 6 seats available
7F Economy Plus. Window. Extra legroom.
```

On an award ticket Economy Plus is a cash seat fee rather than a fare delta, so award options carry an unknown seat cost. Say so rather than omitting it.

## Snapshot versus Read

Unlike Google Flights, united.com needs both.

- **`read`** for prices, fare ladders, and seat maps. Stable.
- **`snapshot`** for clickable refs, because every interaction here needs one.

The snapshot's accessible names encode the flight, which makes the ref-to-flight mapping exact rather than positional:

```
button "Seats for the flight: Depart <City>, <ST>, US (<ORIG>) at 12:05 PM and arrive at 8:34 PM" [ref=e277]
button "United Economy® (Main cabin) From $219 ... select to view fare options" [ref=e280]
button "Economy Plus® (Extra legroom) From $470 ... select to view fare options" [ref=e276]
```

Extract the departure time from the name rather than trusting row order:

```bash
grep -n 'button "Seats for the flight' snap.txt \
  | sed -E 's/.*at ([0-9:]+ [AP]M) and arrive.*ref=(e[0-9]+).*/\1 \2/'
```

**Refs change on every page load and after some clicks.** Re-snapshot rather than reusing them.

## Cookie Banner

The consent banner overlays the bottom of the viewport and silently intercepts clicks aimed at fare buttons:

```
✗ Element 'e483' is covered by <span#cookieconsent:desc> at its click point
```

Click `Accept cookies` once per profile before anything else. The error message names the covering element, so this failure is at least self-describing when it recurs.

## Award Results

`at=1`. Parse with `parseAwardResults()` in `scripts/united.ts`.

- Prices show a cardmember discount as `Was` / `Now`. The `Now` figure is what gets charged.
- `Saver Award` with fare class `XN` or `IN` is the scarce, good-value bucket. `YN` is everyday dynamic pricing.
- Taxes are typically `$5.60` domestic.
- Saver space is rare. Across five dates on one route, exactly one flight had it. Dynamic awards clustered near 1.1 cents per point, below a typical redemption threshold, so the cash-versus-miles answer is usually cash.
