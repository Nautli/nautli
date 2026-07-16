import Cocoa
import WebKit

let DASHBOARD_URL = URL(string: "http://localhost:4600")!
let DASHBOARD_LABEL = "com.nautli.dashboard"

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var retries = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        kickstartServerIfNeeded()

        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1240, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "nautli"
        window.center()
        window.contentView = webView
        window.setFrameAutosaveName("nautli.main")
        window.makeKeyAndOrderFront(nil)

        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        webView.load(URLRequest(url: DASHBOARD_URL))
    }

    // 서버는 launchd가 상시 유지 — 죽어 있을 때만 깨운다.
    func kickstartServerIfNeeded() {
        let probe = Process()
        probe.executableURL = URL(fileURLWithPath: "/usr/bin/nc")
        probe.arguments = ["-z", "127.0.0.1", "4600"]
        probe.standardOutput = FileHandle.nullDevice
        probe.standardError = FileHandle.nullDevice
        try? probe.run()
        probe.waitUntilExit()
        if probe.terminationStatus != 0 {
            let kick = Process()
            kick.executableURL = URL(fileURLWithPath: "/bin/launchctl")
            kick.arguments = ["kickstart", "gui/\(getuid())/\(DASHBOARD_LABEL)"]
            kick.standardOutput = FileHandle.nullDevice
            kick.standardError = FileHandle.nullDevice
            try? kick.run()
            kick.waitUntilExit()
        }
    }

    // 서버 기동 직후 레이스: 로드 실패 시 1초 간격 재시도
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard retries < 15 else { return }
        retries += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.webView.load(URLRequest(url: DASHBOARD_URL))
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        retries = 0
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    // 독 아이콘 클릭 시 창 복원
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate

// 표준 메뉴(Cmd+Q/W/C/V 동작)
let mainMenu = NSMenu()
let appMenuItem = NSMenuItem()
mainMenu.addItem(appMenuItem)
let appMenu = NSMenu()
appMenu.addItem(NSMenuItem(title: "Quit nautli", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
appMenuItem.submenu = appMenu
let editMenuItem = NSMenuItem()
mainMenu.addItem(editMenuItem)
let editMenu = NSMenu(title: "Edit")
editMenu.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
editMenuItem.submenu = editMenu
let windowMenuItem = NSMenuItem()
mainMenu.addItem(windowMenuItem)
let windowMenu = NSMenu(title: "Window")
windowMenu.addItem(NSMenuItem(title: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
windowMenu.addItem(NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
windowMenuItem.submenu = windowMenu
app.mainMenu = mainMenu

app.run()
