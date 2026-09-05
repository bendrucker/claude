#!/usr/bin/env bun

import { cli, command } from "cleye";
import { table } from "table";

import { parseBooking } from "./booking";
import { AMOUNT, amount, present } from "./page-text";

// Google Flights encodes an entire search into the `tfs` query parameter: a
// protobuf message, base64url-encoded without padding. Building it directly
// beats driving the search form, which needs a page load and a settle wait per
// query. The field numbers below were recovered by reading the `tfs` Google
// itself produces and were verified byte-for-byte against real search URLs.

const CABINS = {
  economy: 1,
  premium: 2,
  business: 3,
  first: 4,
} as const;

export type Cabin = keyof typeof CABINS;

// `in` also answers true for inherited keys, which would let `toString` and
// `constructor` through as cabins and encode a garbage byte.
export function isCabin(value: string): value is Cabin {
  return Object.hasOwn(CABINS, value);
}

const ROUND_TRIP = 1;
const ONE_WAY = 2;

export interface Leg {
  date: string;
  origin: string;
  destination: string;
}

export interface SearchParams {
  legs: Leg[];
  cabin?: Cabin;
  nonstop?: boolean;
  /**
   * Sets the field that Google's own UI labels "exclude Basic Economy". On some
   * markets it does not actually reprice; `carryOn` is the filter that does.
   */
  noBasic?: boolean;
  /** Setting it to 1 is what reliably drops Basic Economy fares. */
  carryOn?: number;
  checked?: number;
}

// Protobuf string fields carry UTF-8. Dates and IATA codes are validated ASCII
// before they get here, so the encoding is one byte per character either way.
function ascii(value: string): number[] {
  return [...new TextEncoder().encode(value)];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const IATA = /^[A-Z]{3}$/;

function encodeLeg(leg: Leg, nonstop: boolean): number[] {
  // The date's length prefix is hardcoded to 10, so anything but YYYY-MM-DD
  // silently produces a message that parses into the wrong fields.
  if (!DATE.test(leg.date)) {
    throw new Error(`date must be YYYY-MM-DD, got ${JSON.stringify(leg.date)}`);
  }
  for (const code of [leg.origin, leg.destination]) {
    if (!IATA.test(code)) {
      throw new Error(`airport must be a 3-letter IATA code, got ${JSON.stringify(code)}`);
    }
  }

  const body = [0x12, 0x0a, ...ascii(leg.date)];
  if (nonstop) body.push(0x28, 0x00);
  body.push(0x6a, 0x07, 0x08, 0x01, 0x12, 0x03, ...ascii(leg.origin));
  body.push(0x72, 0x07, 0x08, 0x01, 0x12, 0x03, ...ascii(leg.destination));
  return [0x1a, body.length, ...body];
}

const MAX_BAGS = 9;

function bags(count: number, label: string): number {
  if (!Number.isInteger(count) || count < 0 || count > MAX_BAGS) {
    throw new Error(`${label} bags must be a whole number from 0 to ${MAX_BAGS}, got ${count}`);
  }
  return count;
}

export function tfs(params: SearchParams): string {
  const { legs, cabin = "economy", nonstop = true, noBasic = false } = params;
  if (legs.length === 0) throw new Error("at least one leg is required");

  const message = [0x08, 0x1c, 0x10, 0x02];
  for (const leg of legs) message.push(...encodeLeg(leg, nonstop));
  message.push(0x40, 0x01, 0x48, CABINS[cabin]);
  if (params.carryOn !== undefined || params.checked !== undefined) {
    // Both counts share one field group, so asking for a checked bag alone still
    // has to emit the carry-on byte. Each count is emitted as one raw protobuf
    // byte, so anything outside a single byte would wrap silently and encode a
    // bag count nobody asked for.
    message.push(
      0x6a,
      0x04,
      0x10,
      bags(params.carryOn ?? 0, "carry-on"),
      0x18,
      bags(params.checked ?? 0, "checked"),
    );
  }
  message.push(0x70, 0x01);
  message.push(0x82, 0x01, 0x0b, 0x08, ...Array<number>(9).fill(0xff), 0x01);
  message.push(0x98, 0x01, legs.length > 1 ? ROUND_TRIP : ONE_WAY);
  if (noBasic) message.push(0xc8, 0x01, 0x01);

  return Buffer.from(Uint8Array.from(message)).toString("base64url");
}

export function searchUrl(params: SearchParams): string {
  return `https://www.google.com/travel/flights/search?tfs=${tfs(params)}&hl=en&curr=USD`;
}

// Results are read as rendered text rather than an accessibility snapshot,
// which flaps between full and empty on the same page. Each itinerary renders
// as a fixed block of lines once blank lines are stripped.

export interface Row {
  depart: string;
  departDay: string;
  arrive: string;
  arriveDay: string;
  airline: string;
  duration: string;
  stops: string;
  /** Connecting airports, in order. Empty on a nonstop. */
  via: string[];
  price: number | null;
  basic: boolean;
  redEye: boolean;
}

const BLOCK = new RegExp(
  [
    String.raw`^(\d{1,2}:\d{2}\s*[AP]M)\n`,
    String.raw`\1 on ([^\n]+)\n`,
    String.raw`[–-]\s*(\d{1,2}:\d{2}\s*[AP]M)(?:\+(\d))?\n`,
    String.raw`\3 on ([^\n]+)\n`,
    String.raw`([^\n]+)\n`,
    String.raw`(\d+ hr(?: \d+ min)?|\d+ min)\n`,
  ].join(""),
  "gm",
);

/** How far past a block to look for the price, fare, and stop count that belong to it. */
const TAIL = 1200;
/** Departing this late and landing the next day is what makes a flight a red-eye. */
const RED_EYE_AFTER = 21 * 60;
const DURATION = /^\d+ (?:hr|min)/;
const STOPS = /(Nonstop|\d+ stops?)/;
/**
 * The connecting airports appear in a second, qualified rendering of the stop
 * count ("1 stop in CLT") that sits later in the tail than the bare one, so it
 * needs its own search.
 */
const STOPS_VIA = /\d+ stops? in ([A-Z]{3}(?:, [A-Z]{3})*)/;
/**
 * On a codeshare Google appends an operator note straight onto the carrier name,
 * with no separator: "AlaskaOperated by Alaska as Hawaiian Airlines".
 */
const OPERATED_BY = /Operated by.*$/s;
const PRICE = new RegExp(String.raw`\$(${AMOUNT})`);

function minutesOfDay(time: string): number {
  const match = /(\d+):(\d+)/.exec(time);
  if (!match) return 0;
  const hour = Number(match[1]) % 12;
  const pm = time.toUpperCase().includes("PM");
  return (hour + (pm ? 12 : 0)) * 60 + Number(match[2]);
}

export function parseResults(text: string): Row[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const normalized = `${lines.join("\n")}\n`;

  const seen = new Set<string>();
  const rows: Row[] = [];

  const blocks = [...normalized.matchAll(BLOCK)];

  for (const [position, match] of blocks.entries()) {
    const [whole, depart, departDay, arriveTime, plus, arriveDay, airline, duration] = match;
    if (
      !present(whole) ||
      !present(depart) ||
      !present(departDay) ||
      !present(arriveTime) ||
      !present(arriveDay) ||
      !present(airline) ||
      !present(duration)
    )
      continue;
    // A duration in the carrier slot means the regex lined up with some other
    // repeated layout on the page. Skip it.
    if (DURATION.test(airline)) continue;

    const key = [depart, arriveTime, departDay, airline].join("\x00");
    if (seen.has(key)) continue;
    seen.add(key);

    // The tail holds the fields Google renders after the itinerary line. Stopping
    // at the next itinerary keeps a field this one omitted from being filled in
    // from the following result, which would misprice or misroute the row.
    const end = match.index + whole.length;
    const nextBlock = blocks[position + 1]?.index ?? normalized.length;
    const tail = normalized.slice(end, Math.min(end + TAIL, nextBlock));
    const price = amount(PRICE.exec(tail)?.[1]);
    const stops = STOPS.exec(tail);
    const via = STOPS_VIA.exec(tail);

    rows.push({
      depart,
      departDay,
      arrive: present(plus) ? `${arriveTime}+${plus}` : arriveTime,
      arriveDay,
      airline: airline.replace(OPERATED_BY, "").trim(),
      duration,
      stops: stops?.[1] ?? "?",
      via: via?.[1]?.split(", ") ?? [],
      price,
      // Google states the restriction, and that phrasing survives layout changes
      // better than a "N carry-on bag" string does.
      basic: tail.includes("overhead bin access"),
      redEye: Boolean(plus) && minutesOfDay(depart) >= RED_EYE_AFTER,
    });
  }

  return rows.toSorted((a, b) => minutesOfDay(a.depart) - minutesOfDay(b.depart));
}

const DIM = "\x1b[90m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/**
 * A cell of the Date grid overlay. `back` is null on a one-way search.
 * Dates are the grid's own labels, such as "Nov 8", with no year.
 */
export interface GridCell {
  out: string;
  back: string | null;
  price: number;
  /** Google's own marking for the tier. */
  tier: "cheapest" | "low" | null;
}

/** Round-trip cells name both of their dates. One-way cells name neither. */
const GRID_CELL = new RegExp(String.raw`button "\$(${AMOUNT})((?:, [^",]+)*)"`, "g");
const GRID_DATE = /StaticText "([A-Z][a-z]{2} \d{1,2})"/g;

/**
 * Reads the Date grid out of an accessibility snapshot.
 *
 * The grid is an overlay on the results URL, and it is the one part of Google
 * Flights that `read` cannot see, so this parses a snapshot. Round-trip cells
 * carry both dates in the button's accessible name, which makes the pairing
 * exact. One-way cells carry no date at all and are matched positionally
 * against the header row instead.
 */
export function parseGrid(text: string): GridCell[] {
  const start = text.indexOf('grid "Date grid"');
  if (start === -1) return [];
  const scope = text.slice(start);

  const cells: GridCell[] = [];
  const positional: Pick<GridCell, "price" | "tier">[] = [];

  for (const match of scope.matchAll(GRID_CELL)) {
    const price = amount(match[1]);
    if (price === null) continue;
    const rest = match[2] ?? "";
    const tier = rest.includes("cheapest price")
      ? "cheapest"
      : rest.includes("low price")
        ? "low"
        : null;
    const span = /, ([A-Z][a-z]{2} \d{1,2}) to ([A-Z][a-z]{2} \d{1,2})/.exec(rest);

    const out = span?.[1];
    const back = span?.[2];
    if (present(out) && present(back)) {
      cells.push({ out, back, price, tier });
    } else {
      positional.push({ price, tier });
    }
  }

  if (cells.length > 0) return cells;

  // One-way: the header dates run in the same order as the cells. The grid has no
  // closing marker in the tree, so the header count is what bounds it. Any further
  // price button belongs to the results list underneath.
  const dates = [...scope.matchAll(GRID_DATE)].map((match) => match[1] ?? "");
  return positional.slice(0, dates.length).map((cell, index) => ({
    out: dates[index] ?? "?",
    back: null,
    price: cell.price,
    tier: cell.tier,
  }));
}

// cleye casts a Number flag with `Number()` and does not check the result, so a
// non-numeric --truncate arrives as NaN and slices every airline name to "".
function width(truncate: number): number {
  if (!Number.isInteger(truncate) || truncate < 1) {
    throw new Error(`--truncate must be a whole number of at least 1, got ${truncate}`);
  }
  return truncate;
}

function render(rows: Row[], truncate: number): string {
  const body = rows.map((row) => [
    row.depart,
    row.arrive,
    row.duration,
    row.via.length > 0 ? `${row.stops} (${row.via.join(", ")})` : row.stops,
    row.airline.slice(0, truncate),
    row.price === null ? `${DIM}n/a${RESET}` : `${GREEN}$${row.price.toLocaleString()}${RESET}`,
    [row.basic ? `${RED}BASIC${RESET}` : "", row.redEye ? `${YELLOW}RED-EYE${RESET}` : ""]
      .filter(Boolean)
      .join(" "),
  ]);

  return table([["Depart", "Arrive", "Duration", "Stops", "Airline", "Price", ""], ...body], {
    columns: { 5: { alignment: "right" } },
  });
}

const urlCmd = command(
  {
    name: "url",
    parameters: ["<origin>", "<destination>", "<depart>", "[return]"],
    help: {
      description:
        "Build a Google Flights search URL. Dates are YYYY-MM-DD. Omit [return] for one-way.",
    },
    flags: {
      cabin: {
        type: String,
        default: "economy",
        description: "economy, premium, business, or first",
      },
      stops: {
        type: Boolean,
        description: "Allow connections (default is nonstop only)",
      },
      carryOn: {
        type: Number,
        default: 1,
        description: "Carry-on bags. 1 filters out Basic Economy; pass 0 to see it",
      },
      checked: { type: Number, default: 0, description: "Checked bags" },
    },
  },
  (parsed) => {
    const { origin, destination, depart } = parsed._;
    const back = parsed._.return;
    const cabin = parsed.flags.cabin;
    if (!isCabin(cabin)) {
      throw new Error(
        `unknown cabin ${JSON.stringify(cabin)}; expected ${Object.keys(CABINS).join(", ")}`,
      );
    }

    const legs: Leg[] = [{ date: depart, origin, destination }];
    if (present(back)) legs.push({ date: back, origin: destination, destination: origin });

    console.log(
      searchUrl({
        legs,
        cabin,
        nonstop: !parsed.flags.stops,
        carryOn: parsed.flags.carryOn,
        checked: parsed.flags.checked,
      }),
    );
  },
);

const parseCmd = command(
  {
    name: "parse",
    help: {
      description: "Parse `agent-browser read` output of a results page, from stdin.",
    },
    flags: {
      json: { type: Boolean, description: "Emit rows as JSON" },
      truncate: { type: Number, default: 38, description: "Max airline name width" },
      noRedEye: { type: Boolean, description: "Drop red-eyes instead of marking them" },
      noBasic: { type: Boolean, description: "Drop Basic Economy fares instead of marking them" },
    },
  },
  async (parsed) => {
    const parsedRows = parseResults(await Bun.stdin.text());
    // An empty page and a filter that matched nothing are different failures, and
    // retrying the page load only helps the first. Report them apart.
    if (parsedRows.length === 0) {
      console.error("no itineraries parsed. The page may not have rendered yet.");
      process.exit(1);
    }

    let rows = parsedRows;
    if (parsed.flags.noRedEye) rows = rows.filter((row) => !row.redEye);
    if (parsed.flags.noBasic) rows = rows.filter((row) => !row.basic);
    if (rows.length === 0) {
      console.error(`every one of the ${parsedRows.length} itineraries was filtered out`);
      process.exit(1);
    }

    if (parsed.flags.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    console.log(render(rows, width(parsed.flags.truncate)));
  },
);

/** Round trips lay out as a departure-by-return matrix. One-ways are a single row. */
function renderGrid(cells: GridCell[]): string {
  const money = (cell: GridCell | undefined): string => {
    if (!cell) return `${DIM}-${RESET}`;
    const price = `$${cell.price.toLocaleString()}`;
    if (cell.tier === "cheapest") return `${GREEN}${price}${RESET}`;
    if (cell.tier === "low") return `${YELLOW}${price}${RESET}`;
    return price;
  };

  const outs = [...new Set(cells.map((cell) => cell.out))];

  if (cells.every((cell) => cell.back === null)) {
    return table([outs, outs.map((out) => money(cells.find((cell) => cell.out === out)))]);
  }

  const backs = [...new Set(cells.map((cell) => cell.back))];
  return table([
    [String.raw`out \ back`, ...backs.map((back) => back ?? "?")],
    ...outs.map((out) =>
      [out].concat(
        backs.map((back) => money(cells.find((cell) => cell.out === out && cell.back === back))),
      ),
    ),
  ]);
}

const bookingCmd = command(
  {
    name: "booking",
    help: {
      description:
        "Parse `agent-browser read` output of a booking page, from stdin. Gives flight numbers, aircraft, and the fare ladder.",
    },
    flags: {
      json: { type: Boolean, description: "Emit the booking as JSON" },
    },
  },
  async (parsed) => {
    const booking = parseBooking(await Bun.stdin.text());
    if (booking.segments.length === 0) {
      console.error("no segments parsed. The page may not have rendered yet.");
      process.exit(1);
    }
    if (parsed.flags.json) {
      console.log(JSON.stringify(booking, null, 2));
      return;
    }

    for (const segment of booking.segments) {
      console.log(
        `${segment.origin} -> ${segment.destination}  ${segment.departTime} - ${segment.arriveTime}  ${segment.duration}  ${segment.carrier} ${segment.flight}  ${segment.aircraft}`,
      );
      if (present(segment.warning)) console.log(`  ${RED}${segment.warning}${RESET}`);
      if (present(segment.legroom)) console.log(`  ${DIM}${segment.legroom}${RESET}`);
    }

    if (booking.fares.length > 0) {
      console.log();
      console.log(
        table([
          ["Fare", "Price"],
          ...booking.fares.map((fare) => [
            fare.name,
            fare.price === null
              ? `${DIM}n/a${RESET}`
              : `${GREEN}$${fare.price.toLocaleString()}${RESET}`,
          ]),
        ]),
      );
    }
  },
);

const gridCmd = command(
  {
    name: "grid",
    help: {
      description:
        "Parse the Date grid overlay from `agent-browser snapshot` output, on stdin. Prices every nearby date pair in one page load.",
    },
    flags: {
      json: { type: Boolean, description: "Emit cells as JSON" },
    },
  },
  async (parsed) => {
    const cells = parseGrid(await Bun.stdin.text());
    if (cells.length === 0) {
      console.error("no grid parsed. Snapshot the page after clicking 'Date grid'.");
      process.exit(1);
    }
    if (parsed.flags.json) {
      console.log(JSON.stringify(cells, null, 2));
      return;
    }
    console.log(renderGrid(cells));
    console.log(
      `${GREEN}green${RESET} is Google's cheapest, ${YELLOW}yellow${RESET} its low-price tier`,
    );
  },
);

if (import.meta.main) {
  void cli(
    {
      name: "google-flights",
      commands: [urlCmd, parseCmd, gridCmd, bookingCmd],
      help: {
        description: "Build Google Flights search URLs and parse rendered results.",
      },
    },
    (parsed) => parsed.showHelp(),
  );
}
