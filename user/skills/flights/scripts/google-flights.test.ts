import { describe, expect, test } from "bun:test";

import {
  isCabin,
  parseGrid,
  parseResults,
  searchUrl,
  tfs,
  type SearchParams,
} from "./google-flights";

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

  test.each<[string, number]>([
    ["a count past a byte", 256],
    ["a negative count", -1],
    ["a fraction", 1.5],
  ])("rejects %s of bags, which would wrap to a different number", (_label, carryOn) => {
    expect(() =>
      tfs({ legs: [{ date: "2026-04-15", origin: "LAX", destination: "ORD" }], carryOn }),
    ).toThrow(/carry-on bags must be a whole number/);
  });

  test("encodes a checked bag asked for on its own", () => {
    // Both counts share one protobuf field group, so gating the group on carryOn
    // alone dropped a checked-bag-only search back to no bag filter at all.
    const checkedOnly = tfs({
      legs: [{ date: "2026-04-15", origin: "LAX", destination: "ORD" }],
      checked: 1,
    });
    const noBags = tfs({ legs: [{ date: "2026-04-15", origin: "LAX", destination: "ORD" }] });

    expect(checkedOnly).not.toBe(noBags);
    expect(checkedOnly).toBe(
      tfs({
        legs: [{ date: "2026-04-15", origin: "LAX", destination: "ORD" }],
        carryOn: 0,
        checked: 1,
      }),
    );
  });
});

describe("isCabin", () => {
  test.each(["economy", "premium", "business", "first"])("accepts %s", (cabin) => {
    expect(isCabin(cabin)).toBe(true);
  });

  test.each(["toString", "constructor", "hasOwnProperty", "__proto__", "economy plus", ""])(
    "rejects %p, which `in` would have accepted off the prototype",
    (cabin) => {
      expect(isCabin(cabin)).toBe(false);
    },
  );
});

describe("parseGrid", () => {
  // Google marks a cell "cheapest price", "low price", "selected", or nothing,
  // and a round-trip cell names both of its dates.
  const ROUND_TRIP = `
    - grid "Date grid" [ref=e7]
      - button "$467, cheapest price, Nov 8 to Nov 13" [ref=e10]
      - button "$507, low price, Nov 8 to Nov 15" [ref=e11]
      - button "$587, Nov 8 to Nov 16" [ref=e12]
      - button "$467, Nov 9 to Nov 13, selected" [ref=e13]
`;

  test("pairs both dates off the cell's own label", () => {
    expect(parseGrid(ROUND_TRIP)).toEqual([
      { out: "Nov 8", back: "Nov 13", price: 467, tier: "cheapest" },
      { out: "Nov 8", back: "Nov 15", price: 507, tier: "low" },
      { out: "Nov 8", back: "Nov 16", price: 587, tier: null },
      { out: "Nov 9", back: "Nov 13", price: 467, tier: null },
    ]);
  });

  test("matches one-way cells against the header row by position", () => {
    // A one-way cell names no date at all, so order is the only link to the header.
    const text = `
    - grid "Date grid" [ref=e27]
      - StaticText "Sun"
      - StaticText "Nov 8"
      - StaticText "Mon"
      - StaticText "Nov 9"
      - StaticText "Tue"
      - StaticText "Nov 10"
      - button "$234, cheapest price" [ref=e39]
      - button "$329" [ref=e40]
      - button "$234, cheapest price, selected" [ref=e41]
`;

    expect(parseGrid(text)).toEqual([
      { out: "Nov 8", back: null, price: 234, tier: "cheapest" },
      { out: "Nov 9", back: null, price: 329, tier: null },
      { out: "Nov 10", back: null, price: 234, tier: "cheapest" },
    ]);
  });

  test("ignores prices outside the grid", () => {
    expect(parseGrid('button "$999, Nov 1 to Nov 2"')).toEqual([]);
  });

  test("stops one-way cells at the last header date", () => {
    // The results list sits under the grid overlay and its fare buttons carry the
    // same shape, so the header count is what separates a cell from a result.
    const text = `
    - grid "Date grid" [ref=e27]
      - StaticText "Nov 8"
      - StaticText "Nov 9"
      - button "$234, cheapest price" [ref=e39]
      - button "$329" [ref=e40]
    - list "Results"
      - button "$612" [ref=e80]
`;

    expect(parseGrid(text)).toEqual([
      { out: "Nov 8", back: null, price: 234, tier: "cheapest" },
      { out: "Nov 9", back: null, price: 329, tier: null },
    ]);
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

  test("leaves a field the itinerary omits unfilled by the next one", () => {
    // The tail scanned after each block is wide enough to reach the following
    // itinerary, so a missing price would otherwise be read off its neighbour.
    const text =
      itinerary({ airline: "United", price: "" }) + itinerary({ airline: "Alaska", price: "$274" });
    const rows = parseResults(text);

    expect(rows.map((row) => [row.airline, row.price])).toEqual([
      ["United", null],
      ["Alaska", 274],
    ]);
  });

  test("reads a half-rendered price as absent rather than as zero", () => {
    // The page flaps between full and empty while rendering. A comma with no
    // digits used to match, and `Number("")` is 0, so it showed as a $0 fare.
    const [row] = parseResults(itinerary({ airline: "United", price: "$," }));

    expect(row?.price).toBeNull();
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
