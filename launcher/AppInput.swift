// appinput: post real mouse and keyboard events at the macOS window server.
//
// System Events' `click at` does not reach inside a WKWebView, so driving the
// Lecture Companion window needs genuine CGEvents. QA tooling only; it is not
// part of the shipped bundle.
//
//   appinput click 640 400
//   appinput clickrel 320 210     (relative to window 1's origin)
//   appinput type "Statistical Learning"
//   appinput key return
//   appinput bounds

import AppKit
import CoreGraphics
import Foundation

let keyCodes: [String: CGKeyCode] = [
    "return": 36, "enter": 36, "tab": 48, "space": 49, "escape": 53,
    "delete": 51, "left": 123, "right": 124, "down": 125, "up": 126,
    "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
    // Letters, so the standard editing equivalents can be posted.
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7,
    "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16,
    "t": 17, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40,
    "n": 45, "m": 46,
]

/// Bring the app forward. Events posted to a background window are dropped.
func activateApp() {
    for app in NSWorkspace.shared.runningApplications
    where app.localizedName?.contains("Lecture") == true {
        app.activate(options: [])
        usleep(250_000)
        return
    }
}

func postMouse(x: Double, y: Double) {
    let point = CGPoint(x: x, y: y)
    for (type, button) in [
        (CGEventType.leftMouseDown, CGMouseButton.left),
        (CGEventType.leftMouseUp, CGMouseButton.left),
    ] {
        guard let event = CGEvent(
            mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button
        ) else { continue }
        event.post(tap: .cghidEventTap)
        usleep(60_000)
    }
}

func postKey(_ code: CGKeyCode, flags: CGEventFlags = []) {
    for down in [true, false] {
        guard let event = CGEvent(
            keyboardEventSource: nil, virtualKey: code, keyDown: down
        ) else { continue }
        event.flags = flags
        event.post(tap: .cghidEventTap)
        usleep(18_000)
    }
}

func postText(_ text: String) {
    for scalar in Array(text.utf16) {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
        else { continue }
        var unit = scalar
        down.keyboardSetUnicodeString(stringLength: 1, unicodeString: &unit)
        up.keyboardSetUnicodeString(stringLength: 1, unicodeString: &unit)
        down.post(tap: .cghidEventTap)
        usleep(12_000)
        up.post(tap: .cghidEventTap)
        usleep(12_000)
    }
}

/// Top-left origin screen rect of the frontmost Lecture Companion window.
func appWindowRect() -> CGRect? {
    guard let list = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
    ) as? [[String: Any]] else { return nil }
    for info in list {
        guard let owner = info[kCGWindowOwnerName as String] as? String,
              owner.contains("LectureCompanion") || owner.contains("Lecture Companion"),
              let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary),
              rect.height > 200
        else { continue }
        return rect
    }
    return nil
}

func postScroll(lines: Int32) {
    guard let event = CGEvent(
        scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1,
        wheel1: lines, wheel2: 0, wheel3: 0
    ) else { return }
    event.post(tap: .cghidEventTap)
}

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else {
    FileHandle.standardError.write("usage: appinput <click|clickrel|type|key|bounds> ...\n".data(using: .utf8)!)
    exit(2)
}

switch command {
case "bounds":
    guard let rect = appWindowRect() else {
        FileHandle.standardError.write("no app window found\n".data(using: .utf8)!)
        exit(1)
    }
    print("\(Int(rect.minX)) \(Int(rect.minY)) \(Int(rect.width)) \(Int(rect.height))")
case "click", "clickrel":
    guard args.count >= 3, let x = Double(args[1]), let y = Double(args[2]) else { exit(2) }
    var px = x, py = y
    if command == "clickrel" {
        guard let rect = appWindowRect() else {
            FileHandle.standardError.write("no app window found\n".data(using: .utf8)!)
            exit(1)
        }
        px = rect.minX + x
        py = rect.minY + y
    }
    activateApp()
    postMouse(x: px, y: py)
    print("clicked \(Int(px)) \(Int(py))")
case "type":
    guard args.count >= 2 else { exit(2) }
    activateApp()
    postText(args.dropFirst().joined(separator: " "))
    print("typed")
case "scroll":
    guard args.count >= 2, let amount = Int32(args[1]) else { exit(2) }
    activateApp()
    postScroll(lines: amount * 40)
    print("scrolled \(amount)")
case "key":
    guard args.count >= 2,
          let code = keyCodes[args[1].lowercased()]
            ?? keyCodes[args[1].lowercased() == " " ? "space" : args[1].lowercased()]
    else {
        FileHandle.standardError.write("unknown key\n".data(using: .utf8)!)
        exit(2)
    }
    // Trailing "cmd" posts the equivalent the menu bar is listening for.
    let flags: CGEventFlags = args.contains("cmd") ? .maskCommand : []
    activateApp()
    postKey(code, flags: flags)
    print("key \(args[1])\(args.contains("cmd") ? " cmd" : "")")
default:
    exit(2)
}
