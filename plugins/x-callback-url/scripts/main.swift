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
// stderr: x-error query string or timeout message
// Exit codes: 0 = success, 1 = error, 2 = cancel

let callbackScheme = "xcall-claude"

guard CommandLine.arguments.count >= 2 else {
    fputs("Usage: xcall <url>\n", stderr)
    exit(1)
}

let baseURL = CommandLine.arguments[1]

class CallbackHandler: NSObject {
    var result: String?
    var isError = false
    var exitCode: Int32 = 1
    var done = false

    @objc func handleGetURL(_ event: NSAppleEventDescriptor, withReply _: NSAppleEventDescriptor) {
        guard let urlString = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue,
              let url = URL(string: urlString),
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return
        }

        let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let query = components.query ?? ""

        switch path {
        case "success":
            result = query
            isError = false
            exitCode = 0
        case "error":
            result = query
            isError = true
            exitCode = 1
        case "cancel":
            result = "canceled"
            isError = true
            exitCode = 2
        default:
            return
        }

        done = true
        CFRunLoopStop(CFRunLoopGetMain())
    }
}

let handler = CallbackHandler()

NSAppleEventManager.shared().setEventHandler(
    handler,
    andSelector: #selector(CallbackHandler.handleGetURL(_:withReply:)),
    forEventClass: AEEventClass(kInternetEventClass),
    andEventID: AEEventID(kAEGetURL)
)

// Build the full URL with callback parameters
let successCB = "\(callbackScheme)://x-callback-url/success"
let errorCB = "\(callbackScheme)://x-callback-url/error"
let cancelCB = "\(callbackScheme)://x-callback-url/cancel"

var urlString = baseURL
let sep = urlString.contains("?") ? "&" : "?"
urlString += "\(sep)x-success=\(successCB.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!)"
urlString += "&x-error=\(errorCB.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!)"
urlString += "&x-cancel=\(cancelCB.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!)"

guard let url = URL(string: urlString) else {
    fputs("Invalid URL: \(urlString)\n", stderr)
    exit(1)
}

// Open the URL without activating the target app
let config = NSWorkspace.OpenConfiguration()
config.activates = false

NSWorkspace.shared.open(url, configuration: config) { _, error in
    if let error = error {
        fputs("Failed to open URL: \(error.localizedDescription)\n", stderr)
        exit(1)
    }
}

// Timeout after 10 seconds
DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
    fputs("Timeout waiting for callback\n", stderr)
    exit(1)
}

// Run the event loop to receive callbacks
NSApplication.shared.run()

// Output result
if handler.isError {
    fputs((handler.result ?? "Unknown error") + "\n", stderr)
} else {
    print(handler.result ?? "")
}

exit(handler.exitCode)
