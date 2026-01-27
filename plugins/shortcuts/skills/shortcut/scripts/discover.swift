import Foundation

func sel(_ name: String) -> Selector { Selector((name)) }

func printJSON(_ value: Any) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}

func fatal(_ message: String) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: ["error": message], options: [.sortedKeys])
    fputs(String(data: data, encoding: .utf8)! + "\n", stderr)
    exit(1)
}

// MARK: - Actions

func dumpActions() {
    guard dlopen("/System/Library/PrivateFrameworks/WorkflowKit.framework/WorkflowKit", RTLD_LAZY) != nil else {
        fatal("Could not load WorkflowKit framework")
    }
    let _ = dlopen("/System/Library/PrivateFrameworks/ActionKit.framework/ActionKit", RTLD_LAZY)

    guard let registryClass = NSClassFromString("WFActionRegistry") as? NSObject.Type else {
        fatal("WFActionRegistry class not found")
    }

    let registry = registryClass.perform(sel("sharedRegistry"))!.takeUnretainedValue() as! NSObject

    guard let providers = registry.perform(sel("actionProvidersForLoading"))?.takeUnretainedValue() as? NSArray else {
        fatal("Could not get action providers")
    }

    var allIdentifiers: [String] = []
    for provider in providers {
        let p = provider as! NSObject
        if String(describing: type(of: p)) == "WFBundledActionProvider",
           let ids = p.perform(sel("availableActionIdentifiers"))?.takeUnretainedValue() as? NSSet {
            allIdentifiers = (ids.allObjects as? [String] ?? []).sorted()
            break
        }
    }

    guard !allIdentifiers.isEmpty else {
        fatal("No actions found from BundledActionProvider")
    }

    var actions: [[String: Any]] = []
    for identifier in allIdentifiers {
        guard let action = registry.perform(
            sel("createActionWithIdentifier:serializedParameters:"),
            with: identifier as NSString,
            with: NSDictionary()
        )?.takeUnretainedValue() as? NSObject else { continue }

        var entry: [String: Any] = ["identifier": identifier]

        if let name = action.perform(sel("localizedName"))?.takeUnretainedValue() as? String {
            entry["name"] = name
        }
        if let desc = action.perform(sel("localizedDescriptionSummary"))?.takeUnretainedValue() as? String, !desc.isEmpty {
            entry["description"] = desc
        }
        if let cat = action.perform(sel("localizedCategory"))?.takeUnretainedValue() as? String, !cat.isEmpty {
            entry["category"] = cat
        }
        if let appId = action.perform(sel("appBundleIdentifier"))?.takeUnretainedValue() as? String {
            entry["appBundleIdentifier"] = appId
        }

        if let params = action.perform(sel("parameterDefinitions"))?.takeUnretainedValue() as? [NSObject] {
            var paramList: [[String: Any]] = []
            for param in params {
                var p: [String: Any] = [:]
                if let key = param.perform(sel("objectForKey:"), with: "Key" as NSString)?.takeUnretainedValue() as? String {
                    p["key"] = key
                }
                if let cls = param.perform(sel("objectForKey:"), with: "Class" as NSString)?.takeUnretainedValue() as? String {
                    p["class"] = cls
                }
                if let label = param.perform(sel("objectForKey:"), with: "Label" as NSString)?.takeUnretainedValue() as? String {
                    p["label"] = label
                }
                if let items = param.perform(sel("objectForKey:"), with: "Items" as NSString)?.takeUnretainedValue() as? [String] {
                    p["items"] = items
                }
                if !p.isEmpty { paramList.append(p) }
            }
            if !paramList.isEmpty { entry["parameters"] = paramList }
        }

        actions.append(entry)
    }

    printJSON(actions)
}

// MARK: - Apps

func dumpApps() {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let appDirs = ["\(home)/Applications", "/Applications", "/System/Applications", "/System/Applications/Utilities"]
    var apps: [[String: Any]] = []

    for dir in appDirs {
        guard let contents = try? FileManager.default.contentsOfDirectory(atPath: dir) else { continue }
        for item in contents where item.hasSuffix(".app") {
            let appPath = "\(dir)/\(item)"
            let hasIntents = FileManager.default.fileExists(atPath: "\(appPath)/Contents/Resources/Metadata.appintents")
                || FileManager.default.fileExists(atPath: "\(appPath)/Contents/Metadata.appintents")

            guard hasIntents else { continue }

            var entry: [String: Any] = [
                "name": item.replacingOccurrences(of: ".app", with: ""),
                "path": appPath,
            ]

            if let data = FileManager.default.contents(atPath: "\(appPath)/Contents/Info.plist"),
               let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
               let bundleId = plist["CFBundleIdentifier"] as? String {
                entry["bundleId"] = bundleId
            }

            apps.append(entry)
        }
    }

    apps.sort { ($0["name"] as? String ?? "") < ($1["name"] as? String ?? "") }
    printJSON(apps)
}

// MARK: - CLI

let args = Array(CommandLine.arguments.dropFirst())

guard let command = args.first else {
    fputs("Usage: discover.swift <actions|apps>\n", stderr)
    exit(1)
}

switch command {
case "actions":
    dumpActions()
case "apps":
    dumpApps()
default:
    fputs("Unknown command: \(command)\nUsage: discover.swift <actions|apps>\n", stderr)
    exit(1)
}
