import Cocoa
import WebKit

/// FollowUp's native macOS shell: launches the bundled server, then shows the
/// dashboard in its own window with a dock icon. External links open in the
/// system browser; whatsapp:// and mailto: hand off to their apps directly.
/// Quitting the window terminates the server.

let PORT = 4820

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var server: Process?
    var statusLabel: NSTextField!

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
        launchServer()
        waitForServer(deadline: Date().addingTimeInterval(150))
    }

    // MARK: server lifecycle

    func launchServer() {
        guard let res = Bundle.main.resourceURL else { return }
        let bin = res.appendingPathComponent("followup-server")
        let p = Process()
        p.executableURL = bin
        var env = ProcessInfo.processInfo.environment
        env["FOLLOWUP_OPEN"] = "0"
        p.environment = env
        try? p.run()
        server = p
    }

    func waitForServer(deadline: Date) {
        let url = URL(string: "http://127.0.0.1:\(PORT)/api/stats")!
        var req = URLRequest(url: url)
        req.timeoutInterval = 2
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            DispatchQueue.main.async {
                if let http = resp as? HTTPURLResponse, http.statusCode < 500 {
                    self.statusLabel.isHidden = true
                    self.webView.isHidden = false
                    self.webView.load(URLRequest(url: URL(string: "http://127.0.0.1:\(PORT)/")!))
                } else if Date() < deadline {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                        self.waitForServer(deadline: deadline)
                    }
                } else {
                    self.statusLabel.stringValue = "FollowUp couldn't start its server.\nTry launching again, or check ~/FollowUp."
                }
            }
        }.resume()
    }

    func applicationWillTerminate(_ notification: Notification) {
        // After a self-update the server restarts itself, so the process on the
        // port may not be the child we spawned — ask it to quit over HTTP first.
        let sem = DispatchSemaphore(value: 0)
        var req = URLRequest(url: URL(string: "http://127.0.0.1:\(PORT)/api/quit")!)
        req.httpMethod = "POST"
        req.setValue("quit", forHTTPHeaderField: "X-FollowUp")
        req.timeoutInterval = 1
        URLSession.shared.dataTask(with: req) { _, _, _ in sem.signal() }.resume()
        _ = sem.wait(timeout: .now() + 1.2)
        server?.terminate()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // MARK: window & webview

    func buildWindow() {
        let frame = NSRect(x: 0, y: 0, width: 1280, height: 860)
        window = NSWindow(contentRect: frame,
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "FollowUp"
        window.minSize = NSSize(width: 720, height: 480)
        window.center()
        window.setFrameAutosaveName("FollowUpMain")

        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: frame, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.autoresizingMask = [.width, .height]
        webView.isHidden = true

        statusLabel = NSTextField(labelWithString: "Starting FollowUp…\n(first launch can take a minute)")
        statusLabel.alignment = .center
        statusLabel.font = NSFont.systemFont(ofSize: 16)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.frame = NSRect(x: 0, y: frame.height / 2 - 30, width: frame.width, height: 60)
        statusLabel.autoresizingMask = [.width, .minYMargin, .maxYMargin]

        window.contentView?.addSubview(webView)
        window.contentView?.addSubview(statusLabel)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // Non-localhost links (wa.me fallback, JotForm, mailto:, whatsapp://) leave the shell.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { return decisionHandler(.allow) }
        let isLocal = (url.host == "127.0.0.1" || url.host == "localhost")
        if url.scheme == "http" || url.scheme == "https" {
            if isLocal { return decisionHandler(.allow) }
        }
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    // target=_blank (photos, JotForm links): local ones get their own load, external → browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if url.host == "127.0.0.1" || url.host == "localhost" {
                webView.load(navigationAction.request)
            } else {
                NSWorkspace.shared.open(url)
            }
        }
        return nil
    }

    // MARK: menu (Edit menu is required for paste to work in the token field)

    func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About FollowUp", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide FollowUp", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit FollowUp", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "View")
        let reload = NSMenuItem(title: "Reload", action: #selector(reloadPage), keyEquivalent: "r")
        reload.target = self
        view.addItem(reload)
        viewItem.submenu = view

        NSApp.mainMenu = main
    }

    @objc func reloadPage() { webView.reload() }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
