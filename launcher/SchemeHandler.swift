import Foundation
import WebKit

/// Answers everything the window asks for under `lc://app/`.
///
/// Two jobs, one origin:
///
///   * the interface itself — `index.html`, its hashed bundle, the icon — is
///     read straight out of the bundle and handed back as bytes. It never
///     crosses the network, so there is no page for a browser to find;
///   * `/api/...` is a thin forwarder to the Python process on the loopback
///     port. Forwarding rather than pointing the page at `http://127.0.0.1`
///     keeps everything same-origin, which matters because `app/` is frozen and
///     therefore has no CORS headers to add. A page on a custom scheme fetching
///     from `http://` would be blocked; a page fetching its own scheme is not.
final class SchemeHandler: NSObject, WKURLSchemeHandler {
  private let session = URLSession(configuration: .ephemeral)

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else {
      task.didFailWithError(URLError(.badURL))
      return
    }
    let path = url.path.isEmpty ? "/index.html" : url.path

    if path.hasPrefix("/api/") || path == "/api" {
      proxy(task, url: url, path: path)
    } else {
      serveFile(task, path: path)
    }
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
    // Nothing to cancel: a local file read is synchronous and a proxied request
    // is short. Kept because the protocol requires it.
  }

  // MARK: - the interface, out of the bundle

  private func serveFile(_ task: WKURLSchemeTask, path: String) {
    guard let root = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true) else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }

    // `/static/x` is what the bundle's own HTML asks for, because the server
    // mounts `web/` at `/static`. Here it means the same directory.
    var relative = path
    if relative.hasPrefix("/static/") {
      relative.removeFirst("/static/".count)
    } else if relative == "/favicon.ico" {
      relative = "app-icon.png"
    } else {
      relative = String(relative.drop(while: { $0 == "/" }))
    }
    if relative.isEmpty { relative = "index.html" }

    // No path may escape the directory it is served from.
    let candidate = root.appendingPathComponent(relative).standardizedFileURL
    guard candidate.path.hasPrefix(root.standardizedFileURL.path) else {
      task.didFailWithError(URLError(.noPermissionsToReadFile))
      return
    }

    guard let data = try? Data(contentsOf: candidate) else {
      let response = HTTPURLResponse(
        url: task.request.url!, statusCode: 404, httpVersion: "HTTP/1.1",
        headerFields: ["Content-Type": "text/plain"]
      )!
      task.didReceive(response)
      task.didReceive(Data("not found".utf8))
      task.didFinish()
      return
    }

    let response = HTTPURLResponse(
      url: task.request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
      headerFields: [
        "Content-Type": Self.mimeType(for: candidate.pathExtension),
        "Content-Length": String(data.count),
        // The bundle changes only when the app is rebuilt, and the asset names
        // are content-hashed, so a cache here would only ever be stale.
        "Cache-Control": "no-store",
      ]
    )!
    task.didReceive(response)
    task.didReceive(data)
    task.didFinish()
  }

  private static func mimeType(for extensionName: String) -> String {
    switch extensionName.lowercased() {
    case "html": return "text/html"
    case "js": return "text/javascript"
    case "css": return "text/css"
    case "json": return "application/json"
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "svg": return "image/svg+xml"
    case "woff2": return "font/woff2"
    case "map": return "application/json"
    default: return "application/octet-stream"
    }
  }

  // MARK: - the API, forwarded

  private func proxy(_ task: WKURLSchemeTask, url: URL, path: String) {
    var components = URLComponents(url: AppServer.baseURL, resolvingAgainstBaseURL: false)!
    components.path = path
    components.query = url.query
    guard let target = components.url else {
      task.didFailWithError(URLError(.badURL))
      return
    }

    var request = URLRequest(url: target)
    request.httpMethod = task.request.httpMethod
    request.httpBody = task.request.httpBody
    if let headers = task.request.allHTTPHeaderFields {
      for (name, value) in headers where name.lowercased() != "host" {
        request.setValue(value, forHTTPHeaderField: name)
      }
    }

    session.dataTask(with: request) { data, response, error in
      if let error {
        task.didFailWithError(error)
        return
      }
      guard let http = response as? HTTPURLResponse, let data else {
        task.didFailWithError(URLError(.badServerResponse))
        return
      }
      // The response URL has to be the one the page asked for, not the
      // loopback address it was fetched from, or the web view cross-checks the
      // origin and drops it.
      let rewritten = HTTPURLResponse(
        url: url, statusCode: http.statusCode, httpVersion: "HTTP/1.1",
        headerFields: http.allHeaderFields as? [String: String]
      ) ?? http
      task.didReceive(rewritten)
      task.didReceive(data)
      task.didFinish()
    }.resume()
  }
}
