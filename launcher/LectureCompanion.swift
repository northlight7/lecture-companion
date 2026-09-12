import AppKit
import WebKit

// The backend's address is chosen at launch, not fixed. See `AppServer`.

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private let schemeHandler = SchemeHandler()
    private var backend: Process?
    private var backendLog: FileHandle?
    private var window: NSWindow?
    private var webView: WKWebView?
    private var readinessTimer: Timer?
    private var attempts = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let iconURL = Bundle.main.url(forResource: "AppIcon", withExtension: "icns"),
           let icon = NSImage(contentsOf: iconURL) {
            NSApp.applicationIconImage = icon
        }
        installMenu()
        AppServer.choose()

        if serverIsAlreadyRunning() {
            let alert = NSAlert()
            alert.messageText = "Lecture Companion is already running"
            alert.informativeText = "Close the existing copy before opening a new one."
            alert.alertStyle = .warning
            alert.runModal()
            NSApp.terminate(nil)
            return
        }

        showWindow()
        startBackend()
        waitForBackend()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    /// Clicking the Dock icon of a running app that has no window on screen must
    /// bring the window back. Without this the app does nothing at all: the
    /// process is alive and the backend is serving, but the only way to reach it
    /// is to quit and relaunch, which reads as the app having silently died.
    func applicationShouldHandleReopen(
        _ sender: NSApplication, hasVisibleWindows flag: Bool
    ) -> Bool {
        if !flag {
            if let window {
                window.makeKeyAndOrderFront(nil)
            } else {
                showWindow()
            }
        }
        NSApp.activate(ignoringOtherApps: true)
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        readinessTimer?.invalidate()
        guard let backend, backend.isRunning else { return }
        backend.terminate()
        backend.waitUntilExit()
    }

    private func installMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        let quit = NSMenuItem(
            title: "Quit Lecture Companion",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appMenu.addItem(quit)
        appMenuItem.submenu = appMenu

        // AppKit dispatches the standard editing key equivalents through the
        // menu bar, so a web view with no Edit menu cannot paste. That made the
        // API key field type-only, which is how a key gets mistyped.
        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(
            withTitle: "Close Window",
            action: #selector(NSWindow.performClose(_:)),
            keyEquivalent: "w"
        )
        fileMenuItem.submenu = fileMenu

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        for (title, selector, key) in [
            ("Undo", "undo:", "z"),
            ("Redo", "redo:", "Z"),
            ("Cut", "cut:", "x"),
            ("Copy", "copy:", "c"),
            ("Paste", "paste:", "v"),
            ("Select All", "selectAll:", "a"),
        ] {
            editMenu.addItem(
                withTitle: title, action: Selector((selector)), keyEquivalent: key
            )
        }
        editMenu.insertItem(.separator(), at: 2)
        editMenuItem.submenu = editMenu

        // The standard Control-Command-F shortcut lives on this menu item, so
        // without a View menu full screen has no keyboard route.
        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "View")
        let fullScreen = NSMenuItem(
            title: "Enter Full Screen",
            action: #selector(NSWindow.toggleFullScreen(_:)),
            keyEquivalent: "f"
        )
        fullScreen.keyEquivalentModifierMask = [.control, .command]
        viewMenu.addItem(fullScreen)
        viewMenuItem.submenu = viewMenu

        NSApp.mainMenu = mainMenu
    }

    private func showWindow() {
        let frame = NSRect(x: 0, y: 0, width: 1280, height: 820)
        let window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Lecture Companion"
        // The design direction puts the window chrome inside the sidebar: the
        // traffic lights sit in the sidebar's top-left, in line with its nav,
        // and there is no toolbar anywhere. That needs the web view to extend
        // under the title bar rather than start below it, which is what
        // `.fullSizeContentView` above buys. The title stays set for the
        // Window menu and Mission Control; it is just not drawn.
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = false
        window.setFrameAutosaveName("LectureCompanionMainWindow")
        // A saved frame can name a screen that is no longer attached, or a
        // sliver off the edge. That leaves a real window somewhere the reader
        // cannot see, which looks identical to no window at all.
        let onScreen = NSScreen.screens.contains { $0.visibleFrame.intersects(window.frame) }
        if !onScreen { window.center() }
        // Without this the green button zooms the window to fill the screen but
        // stays windowed. `.fullScreenPrimary` is what actually enters the
        // native full-screen space.
        window.collectionBehavior.insert(.fullScreenPrimary)
        // The layout gate measures at 1024x640, so that is the smallest window
        // the app must survive. Stopping the reader from dragging it smaller is
        // honest: below this the reading column and the sidebar cannot both hold.
        window.minSize = NSSize(width: 1024, height: 640)

        let configuration = WKWebViewConfiguration()
        // `.default()` rather than `.nonPersistent()`, so the reader's own
        // preferences survive a relaunch: the order they drag their courses
        // into, and whether they left the sidebar collapsed. The store is
        // scoped to http://127.0.0.1:8765, which is this app's own page and
        // nothing else, so there is no browsing data to keep out.
        // The page and every asset come off local disk, so an HTTP cache can
        // only ever serve a build that is no longer there: a rebuild changes
        // the hashed asset names, and a cached index.html would then point at
        // a file that does not exist. Three ways to stop that, and only the
        // third works. `WKWebViewConfiguration.urlCache` is iOS-only.
        // `URLCache.shared` is set in this process, and the web view fetches in
        // its own, so it never saw it. Clearing the two cache types on the
        // website data store does reach it, and leaves `WKWebsiteDataTypeLocalStorage`
        // alone, which is where the reader's course order and sidebar state live.
        let store = WKWebsiteDataStore.default()
        store.removeData(
            ofTypes: [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache],
            modifiedSince: .distantPast
        ) { }
        configuration.websiteDataStore = store
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: AppServer.scheme)
        configuration.userContentController.add(self, name: "folderPicker")
        let webView = WKWebView(frame: frame, configuration: configuration)
        webView.uiDelegate = self
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        self.window = window
        self.webView = webView
    }

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = !parameters.allowsDirectories
        panel.canCreateDirectories = false
        panel.resolvesAliases = true

        guard let window else {
            completionHandler(nil)
            return
        }

        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "folderPicker",
              let payload = message.body as? [String: Any],
              let mode = payload["mode"] as? String,
              mode == "bulk" || mode == "course" else { return }
        let courseId = payload["courseId"] as? String ?? ""
        let validCourseId = courseId.range(
            of: #"^[A-Za-z0-9][A-Za-z0-9._-]*$"#,
            options: .regularExpression
        ) != nil
        if mode == "course" && !validCourseId {
            notifyFolderImport(mode: mode, ok: false, message: "The course id is invalid.")
            return
        }
        chooseAndUpload(mode: mode, courseId: courseId)
    }

    // WebKit asks the UI delegate to put up `window.confirm` and `window.alert`.
    // A delegate that does not implement these never answers, so the calling
    // script waits forever and the click that triggered it does nothing. Both
    // Delete buttons are behind a `confirm`, which made them dead in the app
    // while working normally in a browser.
    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
        completionHandler()
    }

    private static let supportedExtensions: Set<String> =
        ["pdf", "pptx", "docx", "xlsx", "csv", "ipynb"]

    /// One panel for both. Choosing files and choosing a folder were two buttons
    /// that opened nearly the same browser, which made the reader decide
    /// something the app can work out for itself.
    private func chooseAndUpload(mode: String, courseId: String) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.canCreateDirectories = false
        panel.resolvesAliases = true
        panel.prompt = "Add"

        guard let window else { return }
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, !panel.urls.isEmpty else { return }
            self?.uploadSelection(panel.urls, mode: mode, courseId: courseId)
        }
    }

    /// Walk a chosen folder. Names keep the folder as a prefix so the server can
    /// still group a mixed pile into courses.
    private func collectFiles(in root: URL) -> [(URL, String)] {
        let keys: [URLResourceKey] = [.isRegularFileKey, .isHiddenKey]
        let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        )
        let prefix = root.standardizedFileURL.path.hasSuffix("/")
            ? root.standardizedFileURL.path
            : root.standardizedFileURL.path + "/"
        var found: [(URL, String)] = []
        while let url = enumerator?.nextObject() as? URL {
            // `~$deck.pptx` is an Office lock file, not a document. It carries a
            // real extension and is not marked hidden, so it used to be uploaded
            // and then fail extraction on the server.
            guard !url.lastPathComponent.hasPrefix("~$") else { continue }
            guard Self.supportedExtensions.contains(url.pathExtension.lowercased()),
                  (try? url.resourceValues(forKeys: Set(keys)).isRegularFile) == true else { continue }
            let relative = String(url.standardizedFileURL.path.dropFirst(prefix.count))
            found.append((url, root.lastPathComponent + "/" + relative))
        }
        return found
    }

    private func uploadSelection(_ selection: [URL], mode: String, courseId: String) {
        var files: [(URL, String)] = []
        var blocked: [URL] = []
        for url in selection {
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else {
                continue
            }
            if isDirectory.boolValue {
                let found = collectFiles(in: url)
                if found.isEmpty {
                    blocked.append(url)
                } else {
                    files.append(contentsOf: found)
                }
            } else if Self.supportedExtensions.contains(url.pathExtension.lowercased()),
                      !url.lastPathComponent.hasPrefix("~$") {
                files.append((url, url.lastPathComponent))
            }
        }
        let label = selection.count == 1
            ? selection[0].lastPathComponent
            : "\(selection.count) items"
        // `root` stays the first selected item purely so the messages below can
        // name something the reader recognises.
        let root = selection[0]
        files.sort { $0.1.localizedStandardCompare($1.1) == .orderedAscending }
        guard !files.isEmpty else {
            // An empty result is not the same as an empty folder. If macOS
            // blocked the directory the enumerator yields nothing, and saying
            // "no supported files" sends the reader looking for the wrong thing.
            let unreadable = blocked.first(where: {
                !FileManager.default.isReadableFile(atPath: $0.path)
            })
            if unreadable != nil {
                notifyFolderImport(
                    mode: mode,
                    ok: false,
                    message: readFailureMessage(root: root, label: label, files: [], error: nil)
                )
                return
            }
            notifyFolderImport(mode: mode, ok: false, message: "No supported course files were found in \(label).")
            return
        }

        let boundary = "LectureCompanion-" + UUID().uuidString
        var body = Data()
        func append(_ text: String) { body.append(text.data(using: .utf8)!) }
        var unreadable: [String] = []
        var firstReadError: Error?
        for (url, relativePath) in files {
            let bytes: Data
            do {
                bytes = try Data(contentsOf: url, options: .mappedIfSafe)
            } catch {
                // One unreadable file must not abandon the folder. Collect it
                // and report it, the way the server reports a failed extraction.
                if firstReadError == nil { firstReadError = error }
                unreadable.append(url.lastPathComponent)
                continue
            }
            let safeName = relativePath.replacingOccurrences(of: "\"", with: "_")
            append("--\(boundary)\r\n")
            append("Content-Disposition: form-data; name=\"files\"; filename=\"\(safeName)\"\r\n")
            append("Content-Type: application/octet-stream\r\n\r\n")
            body.append(bytes)
            append("\r\n")
        }
        append("--\(boundary)--\r\n")

        guard unreadable.count < files.count else {
            notifyFolderImport(
                mode: mode,
                ok: false,
                message: readFailureMessage(
                    root: root, label: label, files: unreadable, error: firstReadError)
            )
            return
        }

        let path = mode == "bulk"
            ? "/api/import/bulk"
            : "/api/courses/\(courseId)/files"
        var request = URLRequest(url: URL(string: "http://127.0.0.1:8765\(path)")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 3600
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            if error != nil {
                self?.notifyFolderImport(mode: mode, ok: false, message: "The folder upload could not reach Lecture Companion.")
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if (200..<300).contains(status) {
                self?.notifyFolderImport(
                    mode: mode,
                    ok: true,
                    message: unreadable.isEmpty
                        ? "Imported \(files.count) files from \(label)."
                        : "Imported \(files.count - unreadable.count) files from "
                            + "\(label). Could not read: "
                            + unreadable.prefix(3).joined(separator: ", ")
                            + (unreadable.count > 3 ? " and \(unreadable.count - 3) more." : ".")
                )
                return
            }
            var message = "The folder import failed with HTTP \(status)."
            if let data,
               let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let detail = object["error"] as? String {
                message = detail
            }
            self?.notifyFolderImport(mode: mode, ok: false, message: message)
        }.resume()
    }

    /// A read that macOS blocked is a different problem from a read that failed
    /// for another reason, and only one of them is something the reader can fix.
    private func readFailureMessage(
        root: URL, label: String, files: [String], error: Error?
    ) -> String {
        let nsError = error as NSError?
        let blocked = nsError?.domain == NSCocoaErrorDomain
            && nsError?.code == NSFileReadNoPermissionError
        if blocked || nsError?.code == 257 {
            return "macOS is not letting Lecture Companion read \(root.path). Open System "
                + "Settings, then Privacy & Security, then Files and Folders, and allow "
                + "Lecture Companion access to that folder. If it is not listed there, "
                + "choose the folder again from inside the app."
        }
        let detail = nsError.map { "\($0.domain) \($0.code): \($0.localizedDescription)" } ?? "unknown"
        return "Could not read \(files.count) file(s) in \(label) (\(detail)). "
            + "First: " + (files.first ?? "-")
    }

    private func notifyFolderImport(mode: String, ok: Bool, message: String) {
        let payload: [String: Any] = ["mode": mode, "ok": ok, "message": message]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript("window.nativeFolderImportFinished(\(json))")
        }
    }

    private func startBackend() {
        let projectRoot = Bundle.main.bundleURL.deletingLastPathComponent()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [projectRoot.appendingPathComponent("run.sh").path]
        process.currentDirectoryURL = projectRoot
        // run.sh already honours LC_PORT; this is what makes the app's backend
        // land on the port `AppServer` picked rather than the default.
        var environment = ProcessInfo.processInfo.environment
        environment["LC_PORT"] = String(AppServer.port)
        process.environment = environment
        // Keep the backend's output. Sending it to /dev/null threw away every
        // line explaining why a slide was skipped, which is how a run can
        // finish with unexplained gaps and nothing to diagnose it with.
        let logURL = projectRoot.appendingPathComponent(".internal/launcher.log")
        try? FileManager.default.createDirectory(
            at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        // Truncate per launch: the log is for the run in front of you.
        try? Data().write(to: logURL)
        if let handle = try? FileHandle(forWritingTo: logURL) {
            backendLog = handle
            process.standardOutput = handle
            process.standardError = handle
        } else {
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
        }

        do {
            try process.run()
            backend = process
        } catch {
            showFailure("Lecture Companion could not start.\n\n\(error.localizedDescription)")
        }
    }

    private func waitForBackend() {
        attempts = 0
        readinessTimer = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: true) { [weak self] timer in
            guard let self else { return }
            attempts += 1

            if backend?.isRunning == false {
                timer.invalidate()
                showFailure("The Lecture Companion backend stopped during startup.")
                return
            }

            URLSession.shared.dataTask(with: AppServer.healthURL) { _, response, _ in
                guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                    if self.attempts >= 180 {
                        DispatchQueue.main.async {
                            timer.invalidate()
                            self.showFailure("Lecture Companion did not finish starting.")
                        }
                    }
                    return
                }
                DispatchQueue.main.async {
                    timer.invalidate()
                    self.webView?.load(URLRequest(url: AppServer.pageURL))
                }
            }.resume()
        }
    }

    private func serverIsAlreadyRunning() -> Bool {
        let semaphore = DispatchSemaphore(value: 0)
        var running = false
        var request = URLRequest(url: AppServer.healthURL)
        request.timeoutInterval = 0.5
        URLSession.shared.dataTask(with: request) { _, response, _ in
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                running = true
            }
            semaphore.signal()
        }.resume()
        _ = semaphore.wait(timeout: .now() + 0.75)
        return running
    }

    private func showFailure(_ message: String) {
        let html = """
        <html><body style="font: 18px -apple-system; padding: 48px; color: #333">
        <h2>Could not start Lecture Companion</h2>
        <p>\(message)</p>
        <p>Press Command-Q to close this app.</p>
        </body></html>
        """
        webView?.loadHTMLString(html, baseURL: nil)
    }
}

/// The entry point.
///
/// An `@main` type rather than top-level code, because the launcher is more
/// than one file now and Swift only allows top-level statements in a file
/// called `main.swift`.
@main
enum LectureCompanion {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}
