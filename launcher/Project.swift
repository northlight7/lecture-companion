import Foundation

/// Where the Python backend lives, and where this app is allowed to write.
///
/// The app is installed into `/Applications` while the project stays wherever
/// the developer keeps it, so the backend's home is *recorded* rather than
/// guessed from the bundle's position. Three sources, in order:
///
///   1. `LC_PROJECT_ROOT`, for a one-off run against another checkout;
///   2. the `ProjectRoot` preference, written by `install.sh` at install time;
///   3. the folder the bundle sits in, which is how the app runs straight out
///      of the project during development.
///
/// A candidate counts only when both halves of the backend are there, so a
/// stale preference pointing at a deleted checkout falls through instead of
/// failing at launch with a message about a path nobody recognises.
///
/// Nothing is written next to the app or inside it. A signed app whose contents
/// changed stops being trusted, and `/Applications` is not a scratch directory.
/// Logs go to `~/Library/Logs/LectureCompanion/`, and the courses are the
/// backend's business, in the per-user application data directory.
enum Project {
  static let defaultsKey = "ProjectRoot"
  static let logDirName = "LectureCompanion"

  /// The project root, or nil when no candidate holds a usable backend.
  static func root() -> URL? {
    candidates().first(where: isUsable)
  }

  /// Every place the backend might be, in the order they are tried. Returned
  /// even when none of them works, so a failure can name what it looked at.
  static func candidates() -> [URL] {
    var found: [URL] = []
    let environment = ProcessInfo.processInfo.environment
    if let raw = environment["LC_PROJECT_ROOT"], !raw.isEmpty {
      found.append(URL(fileURLWithPath: raw, isDirectory: true))
    }
    if let stored = UserDefaults.standard.string(forKey: defaultsKey), !stored.isEmpty {
      found.append(URL(fileURLWithPath: stored, isDirectory: true))
    }
    found.append(Bundle.main.bundleURL.deletingLastPathComponent())
    return found
  }

  /// Both halves of the backend: the launcher script and the environment it
  /// expects to find. A project missing its virtualenv is not usable, and
  /// saying so here is better than a shell error in a log file.
  static func isUsable(_ root: URL) -> Bool {
    let manager = FileManager.default
    guard manager.isReadableFile(atPath: root.appendingPathComponent("run.sh").path) else {
      return false
    }
    return manager.isExecutableFile(atPath: root.appendingPathComponent(".venv/bin/python").path)
  }

  /// This app's own log directory, created on demand.
  static func logDirectory() -> URL? {
    let base = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/Logs", isDirectory: true)
      .appendingPathComponent(logDirName, isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    } catch {
      return nil
    }
    return base
  }

  static func launcherLog() -> URL? {
    logDirectory()?.appendingPathComponent("launcher.log")
  }
}
