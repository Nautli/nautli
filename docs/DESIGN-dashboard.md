# nautli 대시보드 디자인 프레임 v2 — 옵시디언 스타일 (2026-07-13)

레퍼런스 = Obsidian 다크 테마 + 그래프 뷰. 이 문서가 비주얼 SSOT. 여기 없는 색·폰트를 발명하지 않는다.

## 토큰

| 토큰 | 값 | 용도 |
|---|---|---|
| --bg-base | #1e1e1e | 본문 배경 |
| --bg-side | #191919 | 좌측 사이드바 |
| --bg-panel | #242424 | 카드/패널 |
| --bg-hover | #2a2a2a | 행 hover |
| --border | #333333 | 경계선 (1px, 은은하게) |
| --text | #dadada | 본문 |
| --text-muted | #8a8a8a | 보조 |
| --accent | #8b6cef | 옵시디언 퍼플. 활성 탭·primary 버튼·링크·그래프 하이라이트 |
| --accent-soft | rgba(139,108,239,.16) | 활성 배경·글로우 |
| --warn | #e0a355 | 경고·모순 배지 |
| --danger | #e06c6c | 모순 엣지·실패 |
| --ok | #6fbf82 | 완료 체크 |

- 폰트: 시스템 sans 스택(-apple-system, "Segoe UI", "Noto Sans KR", sans-serif). 세리프 디스플레이 폐지. 본문 14px/1.6, 제목은 굵기(600~700)로만 위계.
- radius: 패널 8px, 버튼·입력 6px, 배지 pill.
- 버튼: primary=accent 채움+흰 글자, 기본=투명+1px border, hover에 --bg-hover.
- 그림자 최소화. 경계는 그림자 대신 border.

## 레이아웃 (시그니처 1: 사이드바)

- 좌측 고정 사이드바 200px: 상단 로고 "nautli"(소문자, sans 700), 아래 세로 내비 [설정 / 그래프 / 카드 N / 기억]. 활성 항목 = accent 텍스트 + accent-soft 배경 + 좌측 2px accent 바.
- 본문 max-width 860px, 패딩 32px.
- 좁은 화면(≤720px): 사이드바를 상단 가로 바로 전환(기존 탭처럼). 기능 손실 0.

## 그래프 뷰 (시그니처 2: 옵시디언 그래프의 nautli 버전)

- canvas 기반 force-directed, 외부 의존성 0 (CSP-safe, 단일 파일 유지).
- 노드: 스코프 허브(큰 원, 스코프별 고정 팔레트 색) + fact 노드(작은 원 #9a9a9a, hover 시 accent 글로우). fact는 자기 스코프 허브에 스프링 연결.
- 특수 엣지: superseded_by=accent 실선 / 리뷰 카드 모순 pair=--danger / 중복 pair=--warn. 일반 스코프 엣지는 rgba(255,255,255,.07) 헤어라인.
- 인터랙션: 휠 줌, 드래그 팬, 노드 hover 툴팁(claim 앞 60자), 노드 클릭=기억 탭으로 이동+해당 스코프 필터. 물리 시뮬은 ~3초 감쇠 후 정지(CPU 0).
- 상단 얇은 범례: 허브=프로젝트 · 보라=대체 · 빨강=모순 · 노랑=중복 확인 필요.
- 빈 상태(fact 0): "아직 기억이 없어요. 설정을 마치면 여기서 기억이 자라는 걸 볼 수 있어요." + 설정으로 가기.

## 불변

기존 기능·플로우·카피 전부 유지(스텝퍼·건강검진·모달·토스트·폴링). 테스트 앵커 보존: `id="pending-badge"`, `setChrome()`, `id="manual-copy"`, `클립보드 복사에 실패했어요`, `attempt<120`, `소화 중… 최대 2분`, `finally{if(button.isConnected)`, `checkup-slot`, `중복·모순 판정`.
