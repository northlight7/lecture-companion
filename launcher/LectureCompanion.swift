import AppKit
import WebKit

private let appURL = URL(string: "http://127.0.0.1:8765")!
private let healthURL = URL(string: "http://127.0.0.1:8765/api/health")!

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate {
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

        let webView = WKWebView(frame: frame)
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
