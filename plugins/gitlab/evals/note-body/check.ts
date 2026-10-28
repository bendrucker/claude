// The verdict line the eval-stubs glab prints and records for each note body. The stand-in
// records only bodies of three words or more, so a bare `@<path>` leaves the file empty.
export default function noteLines(body: string): string[] {
  return [`NOTE-SENT ${body.split(/\s+/).filter((w) => w !== "").length} words`];
}
