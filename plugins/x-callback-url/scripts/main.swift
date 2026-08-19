import AppKit
import Foundation

// xcall — Bridge x-callback-url to CLI
//
// Sends a URL scheme request with x-success/x-error/x-cancel callbacks
// pointing to a registered custom URL scheme. Blocks until the target app
// calls back, then outputs the result.
//
// Usage: xcall <url>
// Example: xcall "things:///add?title=Buy%20milk"
//
// stdout: x-success query string (e.g. x-things-id=ABC123)
// stderr: x-error query string
// Exit codes: 0 = success, 1 = error, 2 = cancel
//
// run.sh holds the deadline for this process, from outside it, and passes the
// interval through XCALL_TIMEOUT_SECONDS. In-process scheduling could only
// happen from applicationDidFinishLaunching below, which AppKit skips entirely
// when it cannot reach the WindowServer, the sandboxed case where the callback
// can never arrive.

let callbackScheme = "xcall-claude"

// macOS binds one handler bundle to xcall-claude://, so every concurrently
// waiting instance is a candidate recipient for every callback, and the three
// callback URLs are otherwise identical between them. Without something to tell
// them apart, an instance can accept the answer to another instance's request
// and report that request's id as its own. The token travels out on the
// callback URL and comes back on the event, and an instance answers only to its
// own.
let callbackToken = UUID().uuidString

guard CommandLine.arguments.count >= 2 else {
    fputs("Usage: xcall <url>\n", stderr)
    exit(1)
}

let baseURL = CommandLine.arguments[1]

class AppDelegate: NSObject, NSApplicationDelegate {
    var exitCode: Int32 = 1

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSAppleEventManager.shared().setEventHandler(
            self,
            andSelector: #selector(handleGetURL(_:withReply:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )

        let successCB = "\(callbackScheme)://x-callback-url/success?token=\(callbackToken)"
        let errorCB = "\(callbackScheme)://x-callback-url/error?token=\(callbackToken)"
        let cancelCB = "\(callbackScheme)://x-callback-url/cancel?token=\(callbackToken)"

        var urlString = baseURL
        let sep = urlString.contains("?") ? "&" : "?"
        urlString += "\(sep)x-success=\(successCB.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!)"
        urlString += "&x-error=\(errorCB.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!)"
        urlString += "&x-cancel=\(cancelCB.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!)"

        guard let url = URL(string: urlString) else {
            fputs("Invalid URL: \(urlString)\n", stderr)
            exit(1)
        }

        let config = NSWorkspace.OpenConfiguration()
        config.activates = false

        NSWorkspace.shared.open(url, configuration: config) { _, error in
            if let error = error {
                let nsError = error as NSError
                fputs("Failed to open URL: \(error.localizedDescription) (domain=\(nsError.domain) code=\(nsError.code)) url=\(urlString)\n", stderr)
                exit(1)
            }
        }
    }

    @objc func handleGetURL(_ event: NSAppleEventDescriptor, withReply _: NSAppleEventDescriptor) {
        guard let urlString = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue,
              let url = URL(string: urlString),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return
        }

        let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        // Percent-encoded throughout: the target app's values carry whatever a
        // caller wrote, and decoding here only to re-encode on the way out
        // would be a chance to change them.
        let items = components.percentEncodedQueryItems ?? []
        guard items.first(where: { $0.name == "token" })?.value == callbackToken else {
            return
        }

        // The token is this bridge's own bookkeeping, so it does not reach the
        // caller reading the query off stdout.
        var answer = URLComponents()
        let rest = items.filter { $0.name != "token" }
        answer.percentEncodedQueryItems = rest.isEmpty ? nil : rest
        let query = answer.percentEncodedQuery ?? ""

        switch path {
        case "success":
            print(query)
            exitCode = 0
        case "error":
            fputs(query + "\n", stderr)
            exitCode = 1
        case "cancel":
            fputs("canceled\n", stderr)
            exitCode = 2
        default:
            return
        }

        NSApp.terminate(nil)
    }

    func applicationWillTerminate(_ notification: Notification) {
        exit(exitCode)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
