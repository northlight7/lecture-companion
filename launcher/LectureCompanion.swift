import AppKit
import WebKit

private let appURL = URL(string: "http://127.0.0.1:8765")!
private let healthURL = URL(string: "http://127.0.0.1:8765/api/health")!

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var backend: Process?
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
        NSApp.mainMenu = mainMenu
    }

    private func showWindow() {
        let frame = NSRect(x: 0, y: 0, width: 1280, height: 820)
        let window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Lecture Companion"
        window.center()
        window.setFrameAutosaveName("LectureCompanionMainWindow")

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
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
        chooseAndUploadFolder(mode: mode, courseId: courseId)
    }

    private func chooseAndUploadFolder(mode: String, courseId: String) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = false
        panel.resolvesAliases = true
        panel.prompt = "Import folder"

        guard let window else { return }
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let root = panel.url else { return }
            self?.uploadFolder(root, mode: mode, courseId: courseId)
        }
    }

    private func uploadFolder(_ root: URL, mode: String, courseId: String) {
        let supported = Set(["pdf", "pptx", "docx", "xlsx", "csv", "ipynb"])
        let keys: [URLResourceKey] = [.isRegularFileKey, .isHiddenKey]
        let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        )
        var files: [(URL, String)] = []
        while let url = enumerator?.nextObject() as? URL {
            guard supported.contains(url.pathExtension.lowercased()),
                  (try? url.resourceValues(forKeys: Set(keys)).isRegularFile) == true else { continue }
            let prefix = root.standardizedFileURL.path.hasSuffix("/")
                ? root.standardizedFileURL.path
                : root.standardizedFileURL.path + "/"
            let relative = String(url.standardizedFileURL.path.dropFirst(prefix.count))
            files.append((url, root.lastPathComponent + "/" + relative))
        }
        files.sort { $0.1.localizedStandardCompare($1.1) == .orderedAscending }
        guard !files.isEmpty else {
            notifyFolderImport(mode: mode, ok: false, message: "No supported course files were found.")
            return
        }

        let boundary = "LectureCompanion-" + UUID().uuidString
        var body = Data()
        func append(_ text: String) { body.append(text.data(using: .utf8)!) }
        do {
            for (url, relativePath) in files {
                let safeName = relativePath.replacingOccurrences(of: "\"", with: "_")
                append("--\(boundary)\r\n")
                append("Content-Disposition: form-data; name=\"files\"; filename=\"\(safeName)\"\r\n")
                append("Content-Type: application/octet-stream\r\n\r\n")
                body.append(try Data(contentsOf: url, options: .mappedIfSafe))
                append("\r\n")
            }
            append("--\(boundary)--\r\n")
        } catch {
            notifyFolderImport(mode: mode, ok: false, message: "A file in that folder could not be read.")
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
                    message: "Imported \(files.count) files from \(root.lastPathComponent)."
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
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

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

            URLSession.shared.dataTask(with: healthURL) { _, response, _ in
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
                    self.webView?.load(URLRequest(url: appURL))
                }
            }.resume()
        }
    }

    private func serverIsAlreadyRunning() -> Bool {
        let semaphore = DispatchSemaphore(value: 0)
        var running = false
        var request = URLRequest(url: healthURL)
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

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
