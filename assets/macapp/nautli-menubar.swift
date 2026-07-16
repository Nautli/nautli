import Cocoa

let DASHBOARD_PORT = 4600
let STATUS_URL = URL(string: "http://127.0.0.1:\(DASHBOARD_PORT)/api/status")!
let POLL_SECONDS: TimeInterval = 90

final class MenubarDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var timer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            // 나선 모티프 — SF Symbol 템플릿이라 라이트/다크 자동 대응
            button.image = NSImage(systemSymbolName: "hurricane", accessibilityDescription: "nautli")
            button.imagePosition = .imageLeading
        }

        let menu = NSMenu()
        let openItem = NSMenuItem(title: "대시보드 열기", action: #selector(openDashboard), keyEquivalent: "")
        openItem.target = self
        menu.addItem(openItem)
        let refreshItem = NSMenuItem(title: "새로고침", action: #selector(refreshNow), keyEquivalent: "")
        refreshItem.target = self
        menu.addItem(refreshItem)
        menu.addItem(NSMenuItem.separator())
        let quitItem = NSMenuItem(title: "메뉴바 아이콘 끄기", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        menu.addItem(quitItem)
        statusItem.menu = menu

        refreshNow()
        timer = Timer.scheduledTimer(withTimeInterval: POLL_SECONDS, repeats: true) { [weak self] _ in
            self?.poll()
        }
    }

    @objc func openDashboard() {
        let appURL = URL(fileURLWithPath: NSString(string: "~/Applications/nautli.app").expandingTildeInPath)
        if FileManager.default.fileExists(atPath: appURL.path) {
            NSWorkspace.shared.openApplication(at: appURL, configuration: NSWorkspace.OpenConfiguration())
        } else if let url = URL(string: "http://localhost:\(DASHBOARD_PORT)") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc func refreshNow() { poll() }

    func poll() {
        var request = URLRequest(url: STATUS_URL)
        request.timeoutInterval = 5
        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            var pending: Int? = nil
            if let data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let value = json["pending"] as? Int {
                pending = value
            }
            DispatchQueue.main.async { self?.render(pending: pending) }
        }.resume()
    }

    func render(pending: Int?) {
        guard let button = statusItem.button else { return }
        if let pending {
            button.appearsDisabled = false
            button.title = pending > 0 ? " \(pending)" : ""
            button.toolTip = pending > 0
                ? "리뷰 카드 \(pending)건이 답을 기다려요"
                : "nautli — 대기 중인 카드 없음"
        } else {
            // 서버 다운: 흐리게 + 안내 (KeepAlive가 살릴 때까지)
            button.appearsDisabled = true
            button.title = ""
            button.toolTip = "nautli 대시보드가 꺼져 있어요"
        }
    }
}

let app = NSApplication.shared
let delegate = MenubarDelegate()
app.delegate = delegate
app.run()
