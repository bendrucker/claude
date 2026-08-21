# Google Flights

The cheap pass. No login, fast, covers every carrier. Use it to explore shapes and to get market context, then confirm anything United on united.com.

## URL Construction

Build the URL directly. Never drive the search form. Google Flights encodes an entire search into the `tfs` query parameter, a protobuf message in unpadded base64url. Constructing it directly turns each query into a single page load, where driving the form costs a load plus a settle wait per field.

```bash
bun user/skills/flights/scripts/google-flights.ts url LAX ORD 2026-04-15
bun user/skills/flights/scripts/google-flights.ts url LAX ORD 2026-04-15 2026-04-20 --stops
```

`tfs()` in `scripts/google-flights.ts` is the encoder. Its field map, recovered by reading the `tfs` Google itself produces and verified byte-for-byte against real search URLs:

| Bytes | Meaning |
|---|---|
| `\x08\x1c\x10\x02` | fixed header |
| `\x1a<len>` | one leg, repeated per leg |
| ↳ `\x12\n<YYYY-MM-DD>` | leg date |
| ↳ `(\x00` | nonstop only |
| ↳ `j\x07\x08\x01\x12\x03<ORIG>` | origin IATA |
| ↳ `r\x07\x08\x01\x12\x03<DEST>` | destination IATA |
| `@\x01` | fixed |
| `H<n>` | cabin: 1 economy, 2 premium economy, 3 business, 4 first |
| `j\x04\x10<carry>\x18<checked>` | bag counts |
| `p\x01` | fixed |
| `\x82\x01\x0b\x08\xff×9\x01` | fixed |
| `\x98\x01\x01` | trip type: 1 round trip, 2 one-way |
| `\xc8\x01\x01` | exclude Basic Economy |

The date's length prefix is hardcoded to 10, so a malformed date produces a message that parses into the wrong fields rather than failing. The encoder validates both dates and IATA codes for this reason.

`?q=Flights from...` does **not** run a search. It lands on a prefilled form.

`\x98\x01` is trip type, not cabin. Confusing the two silently returns the wrong results.

## Suppressing Basic Economy

Two fields claim to do this and they do not agree.

`noBasic` sets the field Google's own UI labels "exclude Basic Economy". On at least one market it did not reprice anything. **`carryOn: 1` is what reliably drops Basic fares**, which is why the CLI defaults to it. Pass `--carry-on 0` to see Basic deliberately.

It reprices rather than filters. The same itineraries come back either way, quoted at the fare that includes a carry-on. On one market a nonstop quoted `$235` at `--carry-on 0` came back `$285` at the default, with the Basic marker gone. Row counts matching across the two is the expected result, not a sign the flag did nothing.

Detect Basic in results by the phrase **`overhead bin access`**, not by a `N carry-on bag` string. Google states the restriction rather than the fare name, and that phrasing has survived layout changes better.

`parse --no-basic` drops any row still carrying the marker, and `--no-red-eye` drops a departure at or after 9pm that lands the next day. Marking is the default so a filtered search can say what it removed.

## Reading Results

Use `read`, never `snapshot`. `agent-browser snapshot` flaps between a full tree and an empty one on the same Google Flights page. `read` is stable. Use `read` for everything here.

This is the opposite of united.com, where snapshot is required because every interaction needs a ref. Google Flights needs no clicks once the URL carries the search.

```bash
agent-browser --session flights open "<url>" && sleep 8 && agent-browser --session flights read > dump.txt
bun user/skills/flights/scripts/google-flights.ts parse < dump.txt
```

**Run one query per Bash tool call.** Chaining open, sleep, and read inside a single call is correct and preferred. Splitting them across calls, or looping several queries in one call, is what crashes the daemon. After a crash the session resets to `about:blank`.

Retrying around the daemon compounds the failure: repeated calls kill it faster than letting one call fail.

## Parsing

`parseResults()` matches a fixed block of lines, using a backreference because each time appears twice, once plain and once as `9:41 AM on Tuesday, November 11`:

```
9:41 AM
9:41 AM on Tuesday, November 11
– 6:12 PM
6:12 PM on Tuesday, November 11
United
5 hr 31 min
```

Price, stop count, and the Basic marker are found by scanning a fixed tail past the block rather than by position, since Google varies what sits between.

## The Booking Page

Worth two clicks for a shortlisted itinerary. It carries what the results list omits: flight numbers, aircraft, Google's on-time warning, legroom, and the full fare ladder.

```bash
bun user/skills/flights/scripts/google-flights.ts booking < booking-dump.txt
```

`parseBooking()` anchors on the `Travel time: ` line and walks outward for times and airports, forward for flight, cabin, and aircraft. The aircraft line repeats the flight code with no separator, as in `Airbus A320UA 817`, so the code gets trimmed off the end.

Fares are distinguished from other `###` sections, such as Price insights, by whether they enumerate what they include. A section with a dollar figure and no amenity list is not a fare.

## Trusting the Numbers

Google's fare for a United flight has matched united.com's **Standard** fare exactly in every case checked. It does not match united.com's grid headline, which is often Basic.

That makes Google a good cross-check against the Basic-versus-Standard trap described in [`united.md`](united.md). When the two disagree on a United flight, united.com is the truth and the gap is worth reporting.
