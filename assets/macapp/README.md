# nautli.app 네이티브 래퍼 (macOS)

Swift WKWebView 단일파일 앱 — 대시보드(127.0.0.1:4600)를 자기 창·자기 독 아이콘으로 여는 "옵시디언급" 셸. `nautli setup --step app`의 셸스크립트 런처(크롬 앱모드 창이 크롬 독 아이콘에 묶이는 한계)를 대체하는 상위 버전.

- 빌드: `swiftc -O -framework Cocoa -framework WebKit nautli-app.swift -o nautli` → 번들 `Contents/MacOS/nautli`에 배치 + `codesign -s - --force <app>`
- 동작: 기동 시 nc로 4600 프로브 → 죽어 있으면 launchctl kickstart 후 로드, 로드 실패 시 1초 간격 15회 재시도(서버 기동 레이스), 마지막 창 닫으면 종료, 독 아이콘 재클릭 시 창 복원
- 2026-07-16 유저 맥에서 검증(빌드·독 상주·창). 제품 통합 완료: `nautli setup --step app`이 swiftc 가용 시 이 소스를 빌드해 설치(무가용 시 크롬 앱모드 스크립트 폴백).
