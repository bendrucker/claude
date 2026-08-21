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
const AWARD_TYPE = /^(Saver|Everyday) Award$/;
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
 * Award search on united.com. `at=1` is what switches the results from cash to
 * miles. Without it the same URL returns dollar fares.
 */
export function awardSearchUrl(origin: string, destination: string, date: string): string {
  const params = new URLSearchParams({
    f: origin,
    t: destination,
    d: date,
    tt: "1",
    at: "1",
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
