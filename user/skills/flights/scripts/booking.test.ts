import { describe, expect, test } from "bun:test";

import { parseBooking } from "./booking";

// The booking page states each segment as a run of lines anchored on its travel
// time, with the airports carrying their IATA code in parentheses and the
// aircraft line repeating the flight code with no separator.

const PAGE = `
$470
Lowest total price

9:41 AM
Los Angeles (LAX)
Travel time: 4 hr 31 min
3:12 PM
Chicago (ORD)
United  UA 817
Economy
Airbus A320UA 817
Often delayed by 30+ min
- Average legroom (31 in)
- Wi-Fi for a fee
- In-seat power outlet

### Basic Economy
$219
- Non-refundable
- No carry-on bag

### Economy
$274
- Non-refundable
- 1 carry-on bag

### Price insights
$310
`;

describe("parseBooking", () => {
  test("reads the total", () => {
    expect(parseBooking(PAGE).total).toBe(470);
  });

  test("reads a segment", () => {
    const [segment] = parseBooking(PAGE).segments;

    expect(segment).toMatchObject({
      departTime: "9:41 AM",
      origin: "LAX",
      arriveTime: "3:12 PM",
      destination: "ORD",
      duration: "4 hr 31 min",
      carrier: "United",
      flight: "UA 817",
      cabin: "Economy",
    });
  });

  test("separates the aircraft from the flight code it is glued to", () => {
    expect(parseBooking(PAGE).segments[0]?.aircraft).toBe("Airbus A320");
  });

  test("keeps the on-time warning and the legroom note", () => {
    const [segment] = parseBooking(PAGE).segments;

    expect(segment?.warning).toBe("Often delayed by 30+ min");
    expect(segment?.legroom).toBe("Average legroom (31 in)");
  });

  test("reads the fare ladder", () => {
    expect(parseBooking(PAGE).fares.map((fare) => [fare.name, fare.price])).toEqual([
      ["Basic Economy", 219],
      ["Economy", 274],
    ]);
  });

  test("rejects a priced section that lists no amenities", () => {
    expect(parseBooking(PAGE).fares.map((fare) => fare.name)).not.toContain("Price insights");
  });

  test("returns nothing for a page that has not rendered", () => {
    expect(parseBooking("Loading…")).toEqual({ total: null, segments: [], fares: [] });
  });
});
