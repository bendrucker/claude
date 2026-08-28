// Google Flights' booking page carries what the results list omits: flight
// numbers, aircraft, on-time reputation, legroom, and the full fare ladder.
// Reaching it costs two clicks, so the skill only opens it for shortlisted
// itineraries.

export interface Segment {
  departTime: string;
  origin: string;
  arriveTime: string;
  destination: string;
  duration: string;
  carrier: string;
  flight: string;
  cabin: string;
  aircraft: string;
  /** Google's own on-time warning, e.g. "Often delayed by 30+ min". */
  warning: string | null;
  legroom: string | null;
  amenities: string[];
}

export interface Fare {
  name: string;
  price: number | null;
  amenities: string[];
}

export interface Booking {
  total: number | null;
  segments: Segment[];
  fares: Fare[];
}

const TRAVEL_TIME = "Travel time: ";
const IATA_SUFFIX = /\(([A-Z]{3})\)\s*$/;
const FLIGHT = /^(.+?)\s+([A-Z0-9]{2}\s?\d{1,4})$/;
const PRICE = /^\$([\d,]+)$/;
const BULLET = /^-\s*(.+)$/;
const LEGROOM = /legroom/i;

// A field the page did not supply arrives as undefined when the line is missing
// and as an empty string when the line is there but blank. Both mean absent.
function present(value: string | null | undefined): value is string {
  return value != null && value !== "";
}

function money(value: string | undefined): number | null {
  if (!present(value)) return null;
  const digits = PRICE.exec(value.trim())?.[1];
  return present(digits) ? Number(digits.replaceAll(",", "")) : null;
}

function airport(line: string | undefined): string | null {
  return present(line) ? (IATA_SUFFIX.exec(line)?.[1] ?? null) : null;
}

function parseSegments(lines: string[]): Segment[] {
  const segments: Segment[] = [];

  for (const [index, line] of lines.entries()) {
    if (!line.startsWith(TRAVEL_TIME)) continue;

    const origin = airport(lines[index - 1]);
    const destination = airport(lines[index + 2]);
    const departTime = lines[index - 2];
    const arriveTime = lines[index + 1];
    const flightLine = lines[index + 3];
    const cabin = lines[index + 4];
    const aircraftLine = lines[index + 5];
    if (
      !present(origin) ||
      !present(destination) ||
      !present(departTime) ||
      !present(arriveTime) ||
      !present(flightLine) ||
      !present(cabin) ||
      !present(aircraftLine)
    )
      continue;

    const flightMatch = FLIGHT.exec(flightLine);
    const carrier = flightMatch?.[1];
    const flight = flightMatch?.[2];
    if (!present(carrier) || !present(flight)) continue;

    // The aircraft line repeats the flight code with no separator, as in
    // "Airbus A320UA 817". Trimming the code off the end leaves the aircraft.
    const aircraft = aircraftLine.endsWith(flight)
      ? aircraftLine.slice(0, -flight.length).trim()
      : aircraftLine.trim();

    const amenities: string[] = [];
    let warning: string | null = null;
    for (let cursor = index + 6; cursor < lines.length; cursor++) {
      const detail = lines[cursor];
      if (!present(detail) || detail.startsWith(TRAVEL_TIME) || detail.startsWith("###")) break;
      const bullet = BULLET.exec(detail)?.[1];
      if (present(bullet)) {
        amenities.push(bullet);
        continue;
      }
      // Anything unbulleted straight after the aircraft is Google's on-time note.
      if (cursor === index + 6) warning = detail;
      if (amenities.length > 0) break;
    }

    segments.push({
      departTime,
      origin,
      arriveTime,
      destination,
      duration: line.slice(TRAVEL_TIME.length).trim(),
      carrier,
      flight,
      cabin,
      aircraft,
      warning,
      legroom: amenities.find((item) => LEGROOM.test(item)) ?? null,
      amenities,
    });
  }

  return segments;
}

function parseFares(lines: string[]): Fare[] {
  const fares: Fare[] = [];

  for (const [index, line] of lines.entries()) {
    if (!line.startsWith("### ")) continue;

    const amenities: string[] = [];
    let price: number | null = null;
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const detail = lines[cursor];
      if (!present(detail) || detail.startsWith("###")) break;
      const bullet = BULLET.exec(detail)?.[1];
      if (present(bullet)) {
        amenities.push(bullet);
        continue;
      }
      if (price === null) {
        price = money(detail);
        continue;
      }
      if (amenities.length > 0) break;
    }

    // Every fare enumerates what it includes. Other `###` sections on the page,
    // such as Price insights, carry a dollar figure but no such list.
    if (amenities.length === 0) continue;
    fares.push({ name: line.slice(4).trim(), price, amenities });
  }

  return fares;
}

export function parseBooking(text: string): Booking {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const totalAt = lines.indexOf("Lowest total price");

  return {
    total: totalAt > 0 ? money(lines[totalAt - 1]) : null,
    segments: parseSegments(lines),
    fares: parseFares(lines),
  };
}
