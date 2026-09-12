import Foundation

/// Where the backend is, and how the window reaches it.
///
/// The app is one product: a native window over a Python process. That process
/// speaks HTTP, and the window has to talk to it, so a server exists whenever
/// the app is running. What does NOT have to exist is a web app at a known
/// address that any browser on the machine can open.
///
/// So: a free port chosen at launch rather than a fixed 8765, and the interface
/// itself loaded out of the bundle through a private URL scheme rather than
/// fetched from the server over HTTP. The server is then only ever an API,
/// only ever on a port that did not exist a second ago, and only ever for as
/// long as the app is open.
///
/// `LC_PORT` pins the port when it is set. That is how the capture tool and the
/// gates reach a known address; a reader launching from Finder gets a fresh one
/// every time.
enum AppServer {
  /// The port the backend is on. Zero until `choose()` has run.
  private(set) static var port: Int = 0

  static var baseURL: URL { URL(string: "http://127.0.0.1:\(port)")! }
  static var healthURL: URL { baseURL.appendingPathComponent("api/health") }

  /// The interface, as the window sees it. Everything under this origin is
  /// answered by `SchemeHandler`, never by the network.
  static let pageURL = URL(string: "lc://app/index.html")!
  static let scheme = "lc"

  /// True when the port was pinned by the environment rather than chosen.
  static let pinned: Bool = {
    guard let raw = ProcessInfo.processInfo.environment["LC_PORT"] else { return false }
    return Int(raw.trimmingCharacters(in: .whitespaces)) != nil
  }()

  static func choose() {
    if let raw = ProcessInfo.processInfo.environment["LC_PORT"],
      let value = Int(raw.trimmingCharacters(in: .whitespaces)), value > 0
    {
      port = value
      return
    }
    port = freePort()
  }

  /// Ask the kernel for an unused port by binding to zero and reading it back.
  ///
  /// There is a race between the close and the backend's bind, which is why a
  /// failure to bind is worth retrying rather than treating as fatal. On a
  /// machine where the app is the only thing asking, it does not happen.
  private static func freePort() -> Int {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { return 8765 }
    defer { close(fd) }

    var reuse: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))

    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = 0
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")

    let bound = withUnsafePointer(to: &addr) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    guard bound == 0 else { return 8765 }

    var result = sockaddr_in()
    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    let named = withUnsafeMutablePointer(to: &result) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        getsockname(fd, $0, &length)
      }
    }
    guard named == 0 else { return 8765 }
    return Int(UInt16(bigEndian: result.sin_port))
  }
}
