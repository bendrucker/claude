import { describe, expect, test } from "bun:test";

import { parseAwardResults, render, searchUrl } from "./united";

// Fixtures reproduce the structure of a rendered united.com award page. Every
// value is duplicated into a screen-reader description ("3:00 PMDeparting at
// 3:00 PM"), and each cabin's pricing block renders twice, both of which the
// parser has to absorb.

function flight(body: string): string {
  return `
NONSTOP

3:00 PMDeparting at 3:00 PM

11:31 PMArriving at 11:31 PM

LAXOrigin Los Angeles, CA, US (LAX)

4H, 31MDuration 4 hours and 31 minutes

ORDDestination Chicago, IL, US (ORD)

UA 2225 (Boeing 757-200)Flight Number UA 2225. Aircraft Boeing 757-200

DetailsSeats
${body}
`;
}

const DISCOUNTED_SAVER = `
Economy
cardmembers save 40%
Was
22.5k miles
+$5.60
Now
13.5k
miles
+
$5.60
Saver Award
United Economy (XN)
Add to cart
Select fare for Economy
`.repeat(2);

const DYNAMIC = `
Economy
29.1k miles
+$5.60
Everyday Award
United Economy (YN)
Add to cart
Select fare for Economy
`.repeat(2);

const UNAVAILABLE = `
Not available
Premium Economy
`;

// Built from a char code because a literal escape byte in a regex trips the
// control-character lint.
const STRIP_ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function plain(text: string): string {
  return text.replace(STRIP_ANSI, "");
}

describe("parseAwardResults", () => {
  test("reads the itinerary off the duplicated description lines", () => {
    const [parsed] = parseAwardResults(flight(DYNAMIC));

    expect(parsed).toMatchObject({
      stops: "NONSTOP",
      departTime: "3:00 PM",
      arriveTime: "11:31 PM",
      origin: "LAX",
      destination: "ORD",
      duration: "4H, 31M",
      flight: "UA 2225",
      aircraft: "Boeing 757-200",
    });
  });

  test("takes the discounted price and keeps the pre-discount one", () => {
    const [parsed] = parseAwardResults(flight(DISCOUNTED_SAVER));

    expect(parsed?.fares).toEqual([
      {
        cabin: "Economy",
        miles: 13500,
        standardMiles: 22500,
        taxes: 5.6,
        awardType: "Saver Award",
        fareClass: "United Economy (XN)",
        available: true,
      },
    ]);
  });

  test("collapses the cabin block that renders twice", () => {
    expect(parseAwardResults(flight(DYNAMIC))[0]?.fares).toHaveLength(1);
  });

  test("marks a cabin unavailable without pricing it", () => {
    const [parsed] = parseAwardResults(flight(UNAVAILABLE));

    expect(parsed?.fares).toEqual([
      {
        cabin: "Premium Economy",
        miles: null,
        standardMiles: null,
        taxes: null,
        awardType: null,
        fareClass: null,
        available: false,
      },
    ]);
  });

  test("skips a block with no flight number", () => {
    expect(parseAwardResults("NONSTOP\nsome unrelated text\n")).toEqual([]);
  });
});

describe("render", () => {
  test("formats a saver award", () => {
    expect(plain(render(parseAwardResults(flight(DISCOUNTED_SAVER))))).toMatchSnapshot();
  });

  test("formats a cabin with no award space", () => {
    expect(plain(render(parseAwardResults(flight(UNAVAILABLE))))).toMatchSnapshot();
  });
});

describe("searchUrl", () => {
  test.each<[string, boolean, string]>([
    ["cash", false, "at=0"],
    ["award", true, "at=1"],
  ])("%s search sets %s", (_label, award, expected) => {
    expect(searchUrl("LAX", "ORD", "2026-04-15", award)).toContain(expected);
  });

  test("carries the route and date", () => {
    const url = searchUrl("LAX", "ORD", "2026-04-15");
    expect(url).toContain("f=LAX");
    expect(url).toContain("t=ORD");
    expect(url).toContain("d=2026-04-15");
  });
});
