# Google Flights

The cheap pass. No login, fast, covers every carrier. Use it to explore shapes and to get market context, then confirm anything United on united.com.

## URL Construction

Build the URL directly. Never drive the search form. Google Flights encodes an entire search into the `tfs` query parameter, a protobuf message in unpadded base64url. Constructing it directly turns each query into a single page load, where driving the form costs a load plus a settle wait per field.

```bash
bun ~/.claude/skills/flights/scripts/google-flights.ts url LAX ORD 2026-04-15
bun ~/.claude/skills/flights/scripts/google-flights.ts url LAX ORD 2026-04-15 2026-04-20 --stops
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
| `\x82\x01\x0b\x08\xff\xff\xff\xff\xff\xff\xff\xff\xff\x01` | fixed, nine `\xff` bytes between the `\x08` and the `\x01` |
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

`parse --no-basic` drops any row still carrying the marker. `--no-red-eye` drops a departure at or after 9pm that also lands the next day, so a 10pm arrival the same evening is not a red-eye and a 6am departure is not one either. Both default to marking rather than dropping, so a filtered search can say what it removed.

## The Date Grid

The highest-leverage thing on the page. It prices a whole window of date pairs in **one page load**, which is what makes "is there a better fare a day either side" affordable to ask.

It is an overlay on the results URL, not a page of its own:

```bash
agent-browser --session flights open "<url>" && sleep 9 \
  && agent-browser --session flights find text "Date grid" click && sleep 7 \
  && agent-browser --session flights snapshot > "$TMPDIR/grid.txt"
bun ~/.claude/skills/flights/scripts/google-flights.ts grid < "$TMPDIR/grid.txt"
```

**Snapshot, not read.** This is the one exception to the read-everywhere rule above. `read` returns the results list underneath and never shows the grid, so the click looks like it silently failed. Take a snapshot instead.

A round trip gives a 7×7 departure-by-return matrix. A one-way gives 8 consecutive days.

The two encode dates differently, which `parseGrid()` handles:

| Search | Cell label | Dates come from |
|---|---|---|
| Round trip | `"$467, cheapest price, Nov 8 to Nov 13"` | the label itself |
| One-way | `"$234, cheapest price"` | position against the header row |

Google marks two tiers, `cheapest price` and `low price`, and a third label `selected` marks the dates currently searched. A cell can carry a tier and `selected` together, or neither, so a regex that only allows `cheapest price` silently drops a third of the cells.

Grid labels carry no year. A window opened on a late-December search shows `Jan 3` for a date in the following year, so resolve each cell against the dates the search was built from before turning one back into `YYYY-MM-DD`.

`Scroll left` and `Scroll right` buttons move the window if the useful dates fall outside it.

Grid prices track the filters already applied to the search, including the carry-on repricing described above, so they are comparable with the list's numbers rather than with a bare headline fare.

## Reading Results

Use `read`, never `snapshot`. `agent-browser snapshot` flaps between a full tree and an empty one on the same Google Flights page. `read` is stable. Use `read` for everything here.

This is the opposite of united.com, where snapshot is required because every interaction needs a ref. The results list needs no clicks once the URL carries the search. The Date grid and the booking page are the two places that do, and both are covered below.

```bash
agent-browser --session flights open "<url>" && sleep 8 && agent-browser --session flights read > "$TMPDIR/dump.txt"
bun ~/.claude/skills/flights/scripts/google-flights.ts parse < "$TMPDIR/dump.txt"
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

The stop count renders twice in that tail, first bare (`1 stop`) and then qualified with the connecting airports (`1 stop in CLT`, `2 stops in LAX, NAN`). The bare one comes first, so the airports need their own search rather than an optional group on the first match.

Carrier names are the weak spot. On a codeshare Google appends an operator note straight onto the name with no separator, giving `AlaskaOperated by Alaska as Hawaiian Airlines`. That suffix is stripped. A second form, `QantasAlaska, American`, has no separator to key on and is left as-is, so treat the carrier field as approximate on codeshares and confirm on the booking page when it matters.

## The Booking Page

Worth two clicks for a shortlisted itinerary. It carries what the results list omits: flight numbers, aircraft, Google's on-time warning, legroom, and the full fare ladder.

The two clicks are the itinerary row, then the fare that opens under it. Both need a ref, so this is the one place a snapshot is worth taking, purely to find them:

```bash
agent-browser --session flights snapshot | grep -i "button .*\$"
agent-browser --session flights click "<itinerary ref>" && sleep 4
agent-browser --session flights click "<fare ref>" && sleep 6
agent-browser --session flights read > "$TMPDIR/booking-dump.txt"
bun ~/.claude/skills/flights/scripts/google-flights.ts booking < "$TMPDIR/booking-dump.txt"
```

`parseBooking()` anchors on the `Travel time: ` line and walks outward for times and airports, forward for flight, cabin, and aircraft. The aircraft line repeats the flight code with no separator, as in `Airbus A320UA 817`, so the code gets trimmed off the end.

Fares are distinguished from other `###` sections, such as Price insights, by whether they enumerate what they include. A section with a dollar figure and no amenity list is not a fare.

## Trusting the Numbers

Google's fare for a United flight has matched united.com's **Standard** fare exactly in every case checked. It does not match united.com's grid headline, which is often Basic. That makes Google a useful cross-check against the Basic-versus-Standard trap described in [`united.md`](united.md).
