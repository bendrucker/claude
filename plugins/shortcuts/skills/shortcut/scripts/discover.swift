import Foundation

// MARK: - JSON Helpers

func jsonEscape(_ str: String) -> String {
    str.replacingOccurrences(of: "\\", with: "\\\\")
       .replacingOccurrences(of: "\"", with: "\\\"")
       .replacingOccurrences(of: "\n", with: "\\n")
       .replacingOccurrences(of: "\r", with: "\\r")
       .replacingOccurrences(of: "\t", with: "\\t")
}

func toJSON(_ value: Any, indent: Int = 0) -> String {
    let pad = String(repeating: "  ", count: indent)
    let pad1 = String(repeating: "  ", count: indent + 1)

    if let dict = value as? [String: Any] {
        if dict.isEmpty { return "{}" }
        let entries = dict.sorted(by: { $0.key < $1.key }).map { k, v in
            "\(pad1)\"\(jsonEscape(k))\": \(toJSON(v, indent: indent + 1))"
        }
        return "{\n\(entries.joined(separator: ",\n"))\n\(pad)}"
    } else if let arr = value as? [Any] {
        if arr.isEmpty { return "[]" }
        let items = arr.map { "\(pad1)\(toJSON($0, indent: indent + 1))" }
        return "[\n\(items.joined(separator: ",\n"))\n\(pad)]"
    } else if let str = value as? String {
        return "\"\(jsonEscape(str))\""
    } else if let num = value as? NSNumber {
        if CFBooleanGetTypeID() == CFGetTypeID(num) {
            return num.boolValue ? "true" : "false"
        }
        return "\(num)"
    } else if value is NSNull {
        return "null"
    } else {
        return "\"\(jsonEscape(String(describing: value)))\""
    }
}

// MARK: - WFActions.plist Loading

let wfActionsPath = "/System/Library/PrivateFrameworks/WorkflowKit.framework/WFActions.plist"

func loadActions() -> [String: Any]? {
    guard let data = FileManager.default.contents(atPath: wfActionsPath) else {
        return nil
    }
    guard let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else {
        return nil
    }
    return plist
}

// MARK: - Commands

func listActions(category: String?) {
    guard let actions = loadActions() else {
        print("{\"error\": \"Could not load WFActions.plist from \(wfActionsPath)\"}")
        exit(1)
    }

    var results: [[String: Any]] = []
    for (identifier, value) in actions {
        guard let actionDict = value as? [String: Any] else { continue }

        let cat = actionDict["Category"] as? String ?? ""
        if let filterCategory = category, !cat.localizedCaseInsensitiveContains(filterCategory) {
            continue
        }

        var entry: [String: Any] = ["identifier": identifier]
        if let desc = actionDict["Description"] as? [String: Any],
           let summary = desc["DescriptionSummary"] as? String {
            entry["description"] = summary
        }
        if !cat.isEmpty {
            entry["category"] = cat
        }
        results.append(entry)
    }

    results.sort { ($0["identifier"] as? String ?? "") < ($1["identifier"] as? String ?? "") }
    print(toJSON(["count": results.count, "actions": results]))
}

func describeAction(_ identifier: String) {
    guard let actions = loadActions() else {
        print("{\"error\": \"Could not load WFActions.plist from \(wfActionsPath)\"}")
        exit(1)
    }

    guard let actionDict = actions[identifier] as? [String: Any] else {
        print("{\"error\": \"Action not found\", \"identifier\": \"\(jsonEscape(identifier))\"}")
        exit(1)
    }

    var result: [String: Any] = ["identifier": identifier]

    if let desc = actionDict["Description"] as? [String: Any] {
        if let summary = desc["DescriptionSummary"] as? String {
            result["description"] = summary
        }
        if let input = desc["DescriptionInput"] as? String {
            result["input"] = input
        }
        if let output = desc["DescriptionResult"] as? String {
            result["output"] = output
        }
    }

    if let cat = actionDict["Category"] as? String {
        result["category"] = cat
    }

    if let keywords = actionDict["ActionKeywords"] as? [String] {
        result["keywords"] = keywords
    }

    if let params = actionDict["Parameters"] as? [[String: Any]] {
        var paramList: [[String: Any]] = []
        for param in params {
            var p: [String: Any] = [:]
            if let key = param["Key"] as? String { p["key"] = key }
            if let label = param["Label"] as? String { p["label"] = label }
            if let cls = param["Class"] as? String { p["class"] = cls }
            if let defaultVal = param["DefaultValue"] { p["default"] = defaultVal }
            if let items = param["Items"] as? [String] { p["items"] = items }
            if let required = param["Required"] as? Bool { p["required"] = required }
            if let placeholder = param["Placeholder"] as? String { p["placeholder"] = placeholder }
            paramList.append(p)
        }
        result["parameters"] = paramList
    }

    if let inputType = actionDict["Input"] as? [String: Any] {
        result["inputType"] = inputType
    }

    if let outputType = actionDict["Output"] as? [String: Any] {
        result["outputType"] = outputType
    }

    print(toJSON(result))
}

func searchActions(_ query: String) {
    guard let actions = loadActions() else {
        print("{\"error\": \"Could not load WFActions.plist from \(wfActionsPath)\"}")
        exit(1)
    }

    let queryLower = query.lowercased()
    var results: [[String: Any]] = []

    for (identifier, value) in actions {
        guard let actionDict = value as? [String: Any] else { continue }

        var matches = false

        // Search identifier
        if identifier.lowercased().contains(queryLower) {
            matches = true
        }

        // Search description
        if let desc = actionDict["Description"] as? [String: Any],
           let summary = desc["DescriptionSummary"] as? String,
           summary.lowercased().contains(queryLower) {
            matches = true
        }

        // Search keywords
        if let keywords = actionDict["ActionKeywords"] as? [String],
           keywords.contains(where: { $0.lowercased().contains(queryLower) }) {
            matches = true
        }

        // Search category
        if let cat = actionDict["Category"] as? String,
           cat.lowercased().contains(queryLower) {
            matches = true
        }

        if matches {
            var entry: [String: Any] = ["identifier": identifier]
            if let desc = actionDict["Description"] as? [String: Any],
               let summary = desc["DescriptionSummary"] as? String {
                entry["description"] = summary
            }
            if let cat = actionDict["Category"] as? String {
                entry["category"] = cat
            }
            results.append(entry)
        }
    }

    results.sort { ($0["identifier"] as? String ?? "") < ($1["identifier"] as? String ?? "") }
    print(toJSON(["query": query, "count": results.count, "actions": results]))
}

func listCategories() {
    guard let actions = loadActions() else {
        print("{\"error\": \"Could not load WFActions.plist from \(wfActionsPath)\"}")
        exit(1)
    }

    var categories: [String: Int] = [:]
    for (_, value) in actions {
        guard let actionDict = value as? [String: Any] else { continue }
        let cat = actionDict["Category"] as? String ?? "Uncategorized"
        categories[cat, default: 0] += 1
    }

    let sorted = categories.sorted { $0.key < $1.key }.map { ["name": $0.key, "count": $0.value] as [String: Any] }
    print(toJSON(["count": categories.count, "categories": sorted]))
}

func listAppsWithActions() {
    let appDirs = ["/Applications", "/System/Applications", "/System/Applications/Utilities"]
    var apps: [[String: Any]] = []

    for dir in appDirs {
        guard let contents = try? FileManager.default.contentsOfDirectory(atPath: dir) else { continue }
        for item in contents where item.hasSuffix(".app") {
            let appPath = "\(dir)/\(item)"
            let metadataPath = "\(appPath)/Contents/Resources/Metadata.appintents"
            let altMetadataPath = "\(appPath)/Contents/Metadata.appintents"

            var hasIntents = FileManager.default.fileExists(atPath: metadataPath)
            if !hasIntents {
                hasIntents = FileManager.default.fileExists(atPath: altMetadataPath)
            }

            // Also check for legacy SiriKit intents
            let infoPlistPath = "\(appPath)/Contents/Info.plist"
            var hasLegacyIntents = false
            if let data = FileManager.default.contents(atPath: infoPlistPath),
               let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
               let _ = plist["NSExtension"] as? [String: Any] {
                hasLegacyIntents = true
            }

            if hasIntents || hasLegacyIntents {
                var entry: [String: Any] = ["name": item.replacingOccurrences(of: ".app", with: ""), "path": appPath]
                if hasIntents { entry["appIntents"] = true }
                if hasLegacyIntents { entry["legacyIntents"] = true }

                // Try to get bundle identifier
                if let data = FileManager.default.contents(atPath: infoPlistPath),
                   let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
                   let bundleId = plist["CFBundleIdentifier"] as? String {
                    entry["bundleId"] = bundleId
                }

                apps.append(entry)
            }
        }
    }

    apps.sort { ($0["name"] as? String ?? "") < ($1["name"] as? String ?? "") }
    print(toJSON(["count": apps.count, "apps": apps]))
}

// MARK: - CLI Router

func printUsage() {
    print("""
    {
      "usage": {
        "list": "List all built-in action identifiers",
        "list --category <name>": "Filter actions by category",
        "describe <identifier>": "Get details about a specific action",
        "search <query>": "Search actions by identifier, description, or keywords",
        "categories": "List action categories with counts",
        "apps": "List installed apps that provide Shortcuts actions"
      }
    }
    """)
}

let args = Array(CommandLine.arguments.dropFirst())

guard let command = args.first else {
    printUsage()
    exit(0)
}

switch command {
case "list":
    let category = args.count >= 3 && args[1] == "--category" ? args[2] : nil
    listActions(category: category)
case "describe":
    guard args.count >= 2 else {
        print("{\"error\": \"Usage: discover.swift describe <action-identifier>\"}")
        exit(1)
    }
    describeAction(args[1])
case "search":
    guard args.count >= 2 else {
        print("{\"error\": \"Usage: discover.swift search <query>\"}")
        exit(1)
    }
    searchActions(args[1])
case "categories":
    listCategories()
case "apps":
    listAppsWithActions()
default:
    printUsage()
    exit(1)
}
