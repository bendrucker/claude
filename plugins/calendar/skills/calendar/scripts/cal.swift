import EventKit
import Foundation

let store = EKEventStore()

func requestAccess() -> Bool {
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    if #available(macOS 14.0, *) {
        Task {
            granted = (try? await store.requestFullAccessToEvents()) ?? false
            semaphore.signal()
        }
    } else {
        store.requestAccess(to: .event) { g, _ in
            granted = g
            semaphore.signal()
        }
    }
    semaphore.wait()
    return granted
}

func jsonEscape(_ s: String) -> String {
    s.replacingOccurrences(of: "\\", with: "\\\\")
     .replacingOccurrences(of: "\"", with: "\\\"")
     .replacingOccurrences(of: "\n", with: "\\n")
     .replacingOccurrences(of: "\t", with: "\\t")
}

func formatEvent(_ event: EKEvent) -> String {
    let iso = ISO8601DateFormatter()
    var parts: [String] = []
    parts.append("\"id\": \"\(jsonEscape(event.eventIdentifier ?? ""))\"")
    parts.append("\"summary\": \"\(jsonEscape(event.title ?? ""))\"")
    parts.append("\"start\": \"\(iso.string(from: event.startDate))\"")
    parts.append("\"end\": \"\(iso.string(from: event.endDate))\"")
    parts.append("\"allDay\": \(event.isAllDay)")
    parts.append("\"calendar\": \"\(jsonEscape(event.calendar.title))\"")
    if let location = event.location, !location.isEmpty {
        parts.append("\"location\": \"\(jsonEscape(location))\"")
    }
    if let notes = event.notes, !notes.isEmpty {
        parts.append("\"notes\": \"\(jsonEscape(notes))\"")
    }
    if let url = event.url {
        parts.append("\"url\": \"\(jsonEscape(url.absoluteString))\"")
    }
    if event.hasAttendees, let attendees = event.attendees {
        let names = attendees.map { "\"\(jsonEscape($0.name ?? $0.url.absoluteString))\"" }
        parts.append("\"attendees\": [\(names.joined(separator: ", "))]")
    }
    return "{\(parts.joined(separator: ", "))}"
}

func listCalendars() {
    let calendars = store.calendars(for: .event).sorted { $0.title < $1.title }
    let items = calendars.map { cal -> String in
        let writable = cal.allowsContentModifications
        return "{\"id\": \"\(jsonEscape(cal.calendarIdentifier))\", \"name\": \"\(jsonEscape(cal.title))\", \"writable\": \(writable), \"source\": \"\(jsonEscape(cal.source.title))\"}"
    }
    print("[\(items.joined(separator: ",\n"))]")
}

func listEvents(startStr: String, endStr: String, calendarId: String?) {
    let df = DateFormatter()
    df.dateFormat = "yyyy-MM-dd"
    guard let start = df.date(from: startStr) else {
        print("{\"error\": \"Invalid start date: \(startStr). Use YYYY-MM-DD.\"}")
        exit(1)
    }
    guard let d = df.date(from: endStr) else {
        print("{\"error\": \"Invalid end date: \(endStr). Use YYYY-MM-DD.\"}")
        exit(1)
    }
    let endDate = Calendar.current.date(bySettingHour: 23, minute: 59, second: 59, of: d) ?? d

    var calendars: [EKCalendar]? = nil
    if let cid = calendarId {
        if let cal = store.calendar(withIdentifier: cid) {
            calendars = [cal]
        } else {
            let byName = store.calendars(for: .event).filter { $0.title == cid }
            if !byName.isEmpty {
                calendars = byName
            } else {
                print("{\"error\": \"Calendar not found: \(cid)\"}")
                exit(1)
            }
        }
    }

    let predicate = store.predicateForEvents(withStart: start, end: endDate, calendars: calendars)
    let events = store.events(matching: predicate).sorted { $0.startDate < $1.startDate }
    let items = events.map { formatEvent($0) }
    print("[\(items.joined(separator: ",\n"))]")
}

func getEvent(id: String) {
    guard let event = store.event(withIdentifier: id) else {
        print("{\"error\": \"Event not found\", \"id\": \"\(jsonEscape(id))\"}")
        exit(1)
    }
    print(formatEvent(event))
}

func createEvent(args: [String: String]) {
    guard let title = args["title"],
          let startStr = args["start"],
          let endStr = args["end"] else {
        print("{\"error\": \"Required: --title, --start, --end\"}")
        exit(1)
    }

    let iso = ISO8601DateFormatter()
    let df = DateFormatter()
    df.dateFormat = "yyyy-MM-dd HH:mm"
    let dfDateOnly = DateFormatter()
    dfDateOnly.dateFormat = "yyyy-MM-dd"

    guard let startDate = iso.date(from: startStr) ?? df.date(from: startStr) ?? dfDateOnly.date(from: startStr) else {
        print("{\"error\": \"Invalid start date\"}")
        exit(1)
    }
    guard let endDate = iso.date(from: endStr) ?? df.date(from: endStr) ?? dfDateOnly.date(from: endStr) else {
        print("{\"error\": \"Invalid end date\"}")
        exit(1)
    }

    let calendar: EKCalendar
    if let calId = args["calendar"] {
        if let cal = store.calendar(withIdentifier: calId) {
            calendar = cal
        } else {
            let byName = store.calendars(for: .event).filter { $0.title == calId && $0.allowsContentModifications }
            guard let cal = byName.first else {
                print("{\"error\": \"Writable calendar not found: \(calId)\"}")
                exit(1)
            }
            calendar = cal
        }
    } else {
        guard let cal = store.defaultCalendarForNewEvents else {
            print("{\"error\": \"No default calendar\"}")
            exit(1)
        }
        calendar = cal
    }

    let event = EKEvent(eventStore: store)
    event.title = title
    event.startDate = startDate
    event.endDate = endDate
    event.calendar = calendar
    event.isAllDay = args["allDay"] == "true"
    if let loc = args["location"] { event.location = loc }
    if let notes = args["notes"] { event.notes = notes }

    do {
        try store.save(event, span: .thisEvent)
        print(formatEvent(event))
    } catch {
        print("{\"error\": \"\(jsonEscape(error.localizedDescription))\"}")
        exit(1)
    }
}

func updateEvent(id: String, args: [String: String]) {
    guard let event = store.event(withIdentifier: id) else {
        print("{\"error\": \"Event not found\", \"id\": \"\(jsonEscape(id))\"}")
        exit(1)
    }

    let iso = ISO8601DateFormatter()
    let df = DateFormatter()
    df.dateFormat = "yyyy-MM-dd HH:mm"

    if let title = args["title"] { event.title = title }
    if let startStr = args["start"], let d = iso.date(from: startStr) ?? df.date(from: startStr) { event.startDate = d }
    if let endStr = args["end"], let d = iso.date(from: endStr) ?? df.date(from: endStr) { event.endDate = d }
    if let loc = args["location"] { event.location = loc }
    if let notes = args["notes"] { event.notes = notes }
    if let allDay = args["allDay"] { event.isAllDay = allDay == "true" }

    do {
        try store.save(event, span: .thisEvent)
        print(formatEvent(event))
    } catch {
        print("{\"error\": \"\(jsonEscape(error.localizedDescription))\"}")
        exit(1)
    }
}

func deleteEvent(id: String) {
    guard let event = store.event(withIdentifier: id) else {
        print("{\"error\": \"Event not found\", \"id\": \"\(jsonEscape(id))\"}")
        exit(1)
    }
    let title = event.title ?? ""
    do {
        try store.remove(event, span: .thisEvent)
        print("{\"deleted\": true, \"summary\": \"\(jsonEscape(title))\"}")
    } catch {
        print("{\"error\": \"\(jsonEscape(error.localizedDescription))\"}")
        exit(1)
    }
}

guard requestAccess() else {
    print("{\"error\": \"Calendar access denied\"}")
    exit(1)
}

let cliArgs = CommandLine.arguments
guard cliArgs.count > 1 else {
    fputs("Usage: cal <command> [options]\n", stderr)
    fputs("Commands: calendars, list, get, create, update, delete\n", stderr)
    exit(1)
}

func parseFlags(_ args: [String], from: Int) -> [String: String] {
    var flags: [String: String] = [:]
    var i = from
    while i < args.count - 1 {
        if args[i].hasPrefix("--") {
            let key = String(args[i].dropFirst(2))
            flags[key] = args[i + 1]
            i += 2
        } else {
            i += 1
        }
    }
    return flags
}

switch cliArgs[1] {
case "calendars":
    listCalendars()
case "list":
    let flags = parseFlags(cliArgs, from: 2)
    guard let start = flags["start"], let end = flags["end"] else {
        print("{\"error\": \"Required: --start YYYY-MM-DD --end YYYY-MM-DD\"}")
        exit(1)
    }
    listEvents(startStr: start, endStr: end, calendarId: flags["calendar"])
case "get":
    guard cliArgs.count > 2 else {
        print("{\"error\": \"Required: event ID\"}")
        exit(1)
    }
    getEvent(id: cliArgs[2])
case "create":
    createEvent(args: parseFlags(cliArgs, from: 2))
case "update":
    guard cliArgs.count > 2 else {
        print("{\"error\": \"Required: event ID\"}")
        exit(1)
    }
    updateEvent(id: cliArgs[2], args: parseFlags(cliArgs, from: 3))
case "delete":
    guard cliArgs.count > 2 else {
        print("{\"error\": \"Required: event ID\"}")
        exit(1)
    }
    deleteEvent(id: cliArgs[2])
default:
    fputs("Unknown command: \(cliArgs[1])\n", stderr)
    exit(1)
}
