import { describe, expect, test } from "bun:test";

import { parseResults, searchUrl, tfs, type SearchParams } from "./google-flights";

// `tfs` is a protobuf message Google parses positionally, so a wrong byte does
// not fail. It silently searches for something else. These snapshots are the
// regression guard for encodings that were verified against real search URLs.

const CASES: Array<[string, SearchParams]> = [
  [
    "one-way nonstop economy",
    { legs: [{ date: "2026-04-15", origin: "LAX", destination: "ORD" }] },
  ],
  [
    "round trip",
    {
      legs: [
        { date: "2026-04-15", origin: "LAX", destination: "ORD" },
        { date: "2026-04-20", origin: "ORD", destination: "LAX" },
      ],
    },
  ],
  [
    "connections allowed",
    { legs: [{ date: "2026-04-15", origin: "LAX", destination: "ORD" }], nonstop: false },
  ],
  [
    "business cabin",
    { legs: [{ date: "2026-04-15", origin: "LAX", destination: "ORD" }], cabin: "business" },
  ],
  [
    "one carry-on, which is what drops Basic Economy",
    { legs: [{ date: "2026-04-15", origin: "LAX", destination: "ORD" }], carryOn: 1 },
  ],
  [
    "checked bag",
    { legs: [{ date: "2026-04-15", origin: "LAX", destination: "ORD" }], carryOn: 1, checked: 1 },
  ],
];

describe("tfs", () => {
  test.each(CASES)("encodes %s", (_label, params) => {
    expect(tfs(params)).toMatchSnapshot();
  });

  test("round trip and one-way differ", () => {
    const oneWay = tfs({ legs: [{ date: "2026-04-15", origin: "LAX", destination: "ORD" }] });
    const roundTrip = tfs({
      legs: [
        { date: "2026-04-15", origin: "LAX", destination: "ORD" },
        { date: "2026-04-20", origin: "ORD", destination: "LAX" },
      ],
    });
    expect(oneWay).not.toBe(roundTrip);
  });

  test.each<[string, string]>([
    ["a slashed date", "2026/04/15"],
    ["a short date", "26-04-15"],
    ["an empty date", ""],
  ])("rejects %s, since the length prefix is fixed at 10", (_label, date) => {
    expect(() => tfs({ legs: [{ date, origin: "LAX", destination: "ORD" }] })).toThrow(
      /date must be YYYY-MM-DD/,
    );
  });

  test.each<[string, string]>([
    ["a city name", "Chicago"],
    ["a lowercase code", "ord"],
    ["a two-letter code", "OR"],
  ])("rejects %s as an airport", (_label, destination) => {
    expect(() => tfs({ legs: [{ date: "2026-04-15", origin: "LAX", destination }] })).toThrow(
      /3-letter IATA code/,
    );
  });

  test("requires a leg", () => {
    expect(() => tfs({ legs: [] })).toThrow(/at least one leg/);
  });
});

describe("searchUrl", () => {
  test("carries the encoded search", () => {
    const url = searchUrl({ legs: [{ date: "2026-04-15", origin: "LAX", destination: "ORD" }] });
    expect(url).toStartWith("https://www.google.com/travel/flights/search?tfs=");
    expect(url).toContain("curr=USD");
  });
});

// Google renders each itinerary as a fixed block, with every time repeated once
// plain and once with its weekday. Basic Economy announces itself by the
// restriction it imposes rather than by the fare's name.

function itinerary(options: { airline: string; price: string; extra?: string }): string {
  return `
9:41 AM
9:41 AM on Wednesday, April 15
– 3:12 PM
3:12 PM on Wednesday, April 15
${options.airline}
4 hr 31 min
LAX–ORD
Nonstop
${options.price}
round trip
${options.extra ?? ""}
`;
}

describe("parseResults", () => {
  test("reads a block", () => {
    const [row] = parseResults(itinerary({ airline: "United", price: "$274" }));

    expect(row).toMatchObject({
      depart: "9:41 AM",
      arrive: "3:12 PM",
      airline: "United",
      duration: "4 hr 31 min",
      stops: "Nonstop",
      price: 274,
      basic: false,
    });
  });

  test("flags Basic Economy by its restriction", () => {
    const text = itinerary({
      airline: "United",
      price: "$219",
      extra: "No overhead bin access",
    });

    expect(parseResults(text)[0]?.basic).toBe(true);
  });

  test("keeps an overnight arrival marked", () => {
    const text = `
10:55 PM
10:55 PM on Wednesday, April 15
– 7:21 AM+1
7:21 AM on Thursday, April 16
United
5 hr 26 min
Nonstop
$318
`;

    expect(parseResults(text)[0]?.arrive).toBe("7:21 AM+1");
  });

  test("reads connecting airports from the qualified stop count", () => {
    // The bare "1 stop" comes first in the tail. The airports live in a second,
    // qualified rendering further along, which is why it gets its own search.
    const text = `
9:41 AM
9:41 AM on Wednesday, April 15
– 8:30 PM
8:30 PM on Wednesday, April 15
Alaska, Fiji Airways
13 hr 49 min
2 stops
$744
2 stops in LAX, NAN2 stops13 hr 49 min
`;

    expect(parseResults(text)[0]).toMatchObject({
      stops: "2 stops",
      via: ["LAX", "NAN"],
    });
  });

  test("leaves via empty on a nonstop", () => {
    expect(parseResults(itinerary({ airline: "United", price: "$274" }))[0]?.via).toEqual([]);
  });

  test("drops the operator note appended to a codeshare carrier", () => {
    const text = itinerary({
      airline: "AlaskaOperated by Alaska as Hawaiian Airlines",
      price: "$684",
    });

    expect(parseResults(text)[0]?.airline).toBe("Alaska");
  });

  test("sorts by departure time across noon", () => {
    const text = [
      itinerary({ airline: "United", price: "$274" }),
      `
7:15 AM
7:15 AM on Wednesday, April 15
– 1:02 PM
1:02 PM on Wednesday, April 15
Alaska
4 hr 47 min
Nonstop
$301
`,
    ].join("\n");

    expect(parseResults(text).map((row) => row.depart)).toEqual(["7:15 AM", "9:41 AM"]);
  });

  test.each<[string, string, string, boolean]>([
    ["a late departure landing next day", "10:41 PM", "4:00 AM+1", true],
    ["a late departure landing same day", "10:41 PM", "11:50 PM", false],
    ["an early departure landing next day", "9:41 AM", "3:12 PM", false],
    ["an evening departure landing next day", "6:30 PM", "1:02 AM+1", false],
  ])("treats %s as redEye=%p", (_label, depart, arrive, expected) => {
    const plus = arrive.endsWith("+1");
    const bare = plus ? arrive.slice(0, -2) : arrive;
    const text = `
${depart}
${depart} on Wednesday, April 15
– ${bare}${plus ? "+1" : ""}
${bare} on Thursday, April 16
United
5 hr 26 min
Nonstop
$318
`;

    expect(parseResults(text)[0]?.redEye).toBe(expected);
  });

  test("returns nothing for a page that has not rendered", () => {
    expect(parseResults("Loading…")).toEqual([]);
  });
});
