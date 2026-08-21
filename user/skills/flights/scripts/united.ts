#!/usr/bin/env bun

import { cli, command } from "cleye";
import { table } from "table";

// united.com's award results page is the only source for mileage pricing and
// fare classes. Its rendered text repeats every value twice, once as the visible
// label and once inside the screen-reader description ("3:00 PMDeparting at
// 3:00 PM"), so each field is read off the front of a line and the description
// is discarded.

export interface AwardFare {
  cabin: string;
  /** What the booking actually costs, after any cardmember discount. */
  miles: number | null;
  /** Pre-discount price, present only when a discount applied. */
  standardMiles: number | null;
  taxes: number | null;
  /** "Saver Award" or "Everyday Award". Saver space is the scarce kind. */
  awardType: string | null;
  /** Booking class, e.g. "United Economy (XN)". XN/IN are saver buckets. */
  fareClass: string | null;
  available: boolean;
}

export interface UnitedFlight {
  stops: string;
  departTime: string;
  arriveTime: string;
  origin: string;
  destination: string;
  duration: string;
  flight: string;
  aircraft: string | null;
  fares: AwardFare[];
}

const STOPS = /^(NONSTOP|\d+ STOPS?)$/;
const DEPARTING = /^(.+?)Departing at /;
const ARRIVING = /^(.+?)Arriving at /;
const ORIGIN = /^([A-Z]{3})Origin /;
const DESTINATION = /^([A-Z]{3})Destination /;
const DURATION = /^(.+?)Duration /;
const FLIGHT = /^([A-Z0-9]{2} \d{1,4})(?: \((.+?)\))?Flight Number /;
const MILES = /^([\d,.]+)k?\s*miles$/i;
const BARE_MILES = /^([\d,.]+)k$/i;
const TAXES = /^\+?\$([\d,.]+)$/;
const AWARD_TYPE = /^((?:Saver|Everyday) Award)$/;
const FARE_CLASS = /^(United .+ \([A-Z]{1,2}\))$/;

const CABINS = new Set([
  "Economy",
  "Premium Economy",
  "Business/First",
  "Business/First (lowest)",
  "Business",
  "First",
]);

function miles(token: string): number | null {
  const match = MILES.exec(token) ?? BARE_MILES.exec(token);
  if (!match?.[1]) return null;
  const value = Number(match[1].replaceAll(",", ""));
  if (Number.isNaN(value)) return null;
  // "22.5k" is thousands. A bare "22500" is already absolute.
  return /k$/i.test(token.replace(/\s*miles$/i, "")) ? Math.round(value * 1000) : value;
}

function firstMatch(lines: string[], pattern: RegExp): string | null {
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match?.[1]) return match[1];
  }
  return null;
}

function parseFares(lines: string[]): AwardFare[] {
  const fares: AwardFare[] = [];

  for (const [index, line] of lines.entries()) {
    if (!CABINS.has(line)) continue;
    // "Not available" sits immediately before the cabin name it applies to.
    const unavailable = lines[index - 1] === "Not available";

    const window = lines.slice(index + 1, index + 22);
    const stop = window.findIndex((entry) => CABINS.has(entry) || entry === "Not available");
    const scope = stop === -1 ? window : window.slice(0, stop);

    const amounts: number[] = [];
    for (const entry of scope) {
      const value = miles(entry);
      if (value !== null) amounts.push(value);
    }

    const discounted = scope.includes("Was") && scope.includes("Now");
    const taxes = firstMatch(scope, TAXES);

    fares.push({
      cabin: line,
      // With a discount the page lists the old price first, then the new one.
      miles: unavailable ? null : discounted ? (amounts[1] ?? null) : (amounts[0] ?? null),
      standardMiles: discounted ? (amounts[0] ?? null) : null,
      taxes: taxes ? Number(taxes.replaceAll(",", "")) : null,
      awardType: firstMatch(scope, AWARD_TYPE),
      fareClass: firstMatch(scope, FARE_CLASS),
      available: !unavailable,
    });
  }

  // Each cabin's pricing block renders twice on the page.
  return fares.filter(
    (fare, index) =>
      fares.findIndex(
        (other) => other.cabin === fare.cabin && other.available === fare.available,
      ) === index,
  );
}

export function parseAwardResults(text: string): UnitedFlight[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const starts = lines.flatMap((line, index) => (STOPS.test(line) ? [index] : []));
  const flights: UnitedFlight[] = [];

  for (const [position, start] of starts.entries()) {
    const block = lines.slice(start, starts[position + 1] ?? lines.length);
    const flightLine = block.find((line) => FLIGHT.test(line));
    const flightMatch = flightLine ? FLIGHT.exec(flightLine) : null;
    if (!flightMatch?.[1]) continue;

    const departTime = firstMatch(block, DEPARTING);
    const arriveTime = firstMatch(block, ARRIVING);
    const origin = firstMatch(block, ORIGIN);
    const destination = firstMatch(block, DESTINATION);
    if (!departTime || !arriveTime || !origin || !destination) continue;

    flights.push({
      stops: block[0] ?? "?",
      departTime,
      arriveTime,
      origin,
      destination,
      duration: firstMatch(block, DURATION) ?? "?",
      flight: flightMatch[1],
      aircraft: flightMatch[2] ?? null,
      fares: parseFares(block),
    });
  }

  return flights;
}

/**
 * Search on united.com. `at` is what switches the results between dollars and
 * miles, and is the whole of the award search.
 */
export function searchUrl(
  origin: string,
  destination: string,
  date: string,
  award = false,
): string {
  const params = new URLSearchParams({
    f: origin,
    t: destination,
    d: date,
    tt: "1",
    at: award ? "1" : "0",
    sc: "7",
    px: "1",
    taxng: "1",
    newHP: "True",
    clm: "7",
    st: "bestmatches",
    tqp: "A",
  });
  return `https://www.united.com/en/us/fsr/choose-flights?${params}`;
}

export function awardSearchUrl(origin: string, destination: string, date: string): string {
  return searchUrl(origin, destination, date, true);
}

const DIM = "\x1b[90m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

const IATA = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function minutesOfDay(time: string): number {
  const match = /(\d+):(\d+)/.exec(time);
  if (!match) return 0;
  const hour = Number(match[1]) % 12;
  return (hour + (time.toUpperCase().includes("PM") ? 12 : 0)) * 60 + Number(match[2]);
}

export function render(flights: UnitedFlight[]): string {
  const body: string[][] = [];
  const ordered = [...flights].sort(
    (a, b) => minutesOfDay(a.departTime) - minutesOfDay(b.departTime),
  );

  for (const flight of ordered) {
    const available = flight.fares.filter((fare) => fare.available && fare.miles !== null);
    const cells = [
      flight.departTime,
      flight.arriveTime,
      flight.duration,
      flight.stops,
      flight.flight,
      flight.aircraft ?? "",
    ];

    if (available.length === 0) {
      body.push([...cells, `${DIM}none${RESET}`, "", ""]);
      continue;
    }

    for (const [index, fare] of available.entries()) {
      // Repeating the itinerary on every fare row would bury the flight it
      // belongs to, so only the first row of a flight carries it.
      const lead = index === 0 ? cells : ["", "", "", "", "", ""];
      const saver = fare.awardType?.startsWith("Saver");
      const miles = fare.miles?.toLocaleString() ?? "";
      const bucket = fare.fareClass ?? `${DIM}dynamic${RESET}`;
      body.push([
        ...lead,
        fare.cabin,
        saver ? `${GREEN}${miles}${RESET}` : miles,
        saver ? `${GREEN}${fare.fareClass ?? "saver"}${RESET}` : bucket,
      ]);
    }
  }

  return table(
    [
      ["Depart", "Arrive", "Duration", "Stops", "Flight", "Aircraft", "Cabin", "Miles", ""],
      ...body,
    ],
    { columns: { 7: { alignment: "right" } } },
  );
}

const urlCmd = command(
  {
    name: "url",
    parameters: ["<origin>", "<destination>", "<date>"],
    help: {
      description: "Build a united.com one-way search URL. Date is YYYY-MM-DD.",
    },
    flags: {
      award: { type: Boolean, description: "Price in miles instead of dollars" },
    },
  },
  (parsed) => {
    const { origin, destination, date } = parsed._;
    for (const code of [origin, destination]) {
      if (!IATA.test(code)) {
        throw new Error(`airport must be a 3-letter IATA code, got ${JSON.stringify(code)}`);
      }
    }
    if (!DATE.test(date)) {
      throw new Error(`date must be YYYY-MM-DD, got ${JSON.stringify(date)}`);
    }
    console.log(searchUrl(origin, destination, date, parsed.flags.award));
  },
);

const parseCmd = command(
  {
    name: "parse",
    help: {
      description: "Parse `agent-browser read` output of an award results page, from stdin.",
    },
    flags: {
      json: { type: Boolean, description: "Emit flights as JSON" },
    },
  },
  async (parsed) => {
    const flights = parseAwardResults(await Bun.stdin.text());
    if (parsed.flags.json) {
      console.log(JSON.stringify(flights, null, 2));
      return;
    }
    if (flights.length === 0) {
      console.error("no flights parsed — page may not have rendered yet");
      process.exit(1);
    }
    console.log(render(flights));

    const saver = flights.filter((flight) =>
      flight.fares.some((fare) => fare.available && fare.awardType?.startsWith("Saver")),
    );
    console.log(
      saver.length > 0
        ? `${GREEN}saver space on ${saver.map((flight) => flight.flight).join(", ")}${RESET}`
        : `${YELLOW}no saver space; everything here is dynamically priced${RESET}`,
    );
  },
);

if (import.meta.main) {
  cli(
    {
      name: "united",
      commands: [urlCmd, parseCmd],
      help: {
        description: "Build united.com search URLs and parse rendered award results.",
      },
    },
    (parsed) => parsed.showHelp(),
  );
}
