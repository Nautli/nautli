# nautli 대시보드 디자인 프레임 v3 — Orca 룩 (2026-07-15)

레퍼런스 = Orca(stablyai)의 shadcn/Geist 계열 UI. 절제된 중성 그레이, 얇은 경계, 잉크처럼 선명한 타이포그래피가 핵심이다. 이 문서가 대시보드 비주얼의 SSOT이며, 여기 정의되지 않은 색이나 웹폰트를 추가하지 않는다.

## 원칙

- 라이트 모드가 기본이며 `prefers-color-scheme`에 따라 다크 모드를 자동 적용한다.
- 배경·카드·사이드바는 무채색 면과 1px 경계로 구분한다. 그림자는 꼭 필요한 오버레이 외에는 사용하지 않는다.
- primary는 브랜드 컬러가 아니라 잉크색 채움이다. 라이트에서는 거의 검정, 다크에서는 밝은 회색을 쓴다.
- violet은 AI가 수행한 일의 진행 상태, 활성 탭 인디케이터, 그래프의 대체 관계에만 쓴다.
- 성공·위험·중복 상태 외에는 채도 높은 색을 쓰지 않는다.

## 라이트 토큰 (`:root`)

| 토큰 | 값 | 용도 |
|---|---|---|
| `--background` | `#fff` | 앱 기본 배경, 그래프 무대 |
| `--foreground` | `#0a0a0a` | 기본 텍스트 |
| `--card` | `#fff` | 카드와 모달 |
| `--sidebar` | `#fafafa` | 사이드바 |
| `--sidebar-border` | `#e5e5e5` | 사이드바 경계 |
| `--primary` | `#171717` | primary 버튼 채움 |
| `--primary-foreground` | `#fafafa` | primary 버튼 텍스트 |
| `--secondary` | `#f5f5f5` | 활성 내비게이션, 보조 면 |
| `--muted` | `#f5f5f5` | 비활성 면, 진행바 트랙 |
| `--accent` | `#f5f5f5` | hover 면 |
| `--muted-foreground` | `#737373` | 설명, 메타데이터, 비활성 텍스트 |
| `--border` | `#e5e5e5` | 카드와 구획 경계 |
| `--input` | `#e5e5e5` | 입력 필드 경계 |
| `--ring` | `#a1a1a1` | 키보드 포커스 링 |
| `--destructive` | `#e40014` | 실패, 모순, 위험 액션 |
| `--status-success` | `#15803d` | 완료와 연결 성공 |
| `--status-warning` | `#f59e0b` | 중복, 확인 필요 |
| `--ai-action-accent` | `#8b5cf6` | AI 진행, 활성 탭 인디케이터, 대체 엣지 |

## 다크 토큰 (`@media (prefers-color-scheme: dark)`)

| 토큰 | 값 | 용도 |
|---|---|---|
| `--background` | `#0a0a0a` | 앱 기본 배경, 그래프 무대 |
| `--foreground` | `#fafafa` | 기본 텍스트 |
| `--card` | `#171717` | 카드와 모달 |
| `--sidebar` | `#171717` | 사이드바 |
| `--sidebar-border` | `rgb(255 255 255 / 0.07)` | Orca 시그니처 7% 헤어라인 |
| `--primary` | `#e5e5e5` | primary 버튼 채움 |
| `--primary-foreground` | `#171717` | primary 버튼 텍스트 |
| `--secondary` | `#262626` | 활성 내비게이션, 보조 면 |
| `--muted` | `#262626` | 비활성 면, 진행바 트랙 |
| `--accent` | `#404040` | hover 면 |
| `--muted-foreground` | `#a1a1a1` | 설명, 메타데이터, 비활성 텍스트 |
| `--border` | `rgb(255 255 255 / 0.07)` | 카드와 구획의 7% 헤어라인 |
| `--input` | `rgb(255 255 255 / 0.15)` | 입력 필드 경계 |
| `--ring` | `#a1a1a1` | 키보드 포커스 링 |
| `--destructive` | `#ff6568` | 실패, 모순, 위험 액션 |
| `--status-success` | `#86efac` | 완료와 연결 성공 |
| `--status-warning` | `#fbbf24` | 중복, 확인 필요 |
| `--ai-action-accent` | `#a78bfa` | AI 진행, 활성 탭 인디케이터, 대체 엣지 |

성공 상태의 배경은 `--status-success` 10% 믹스, 경계는 25% 믹스를 사용한다. 그 외 파생색은 만들지 않는다.

## 타이포그래피와 형태

- sans: `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif`.
- mono: `"SF Mono", ui-monospace, Menlo, monospace`.
- 웹폰트는 사용하지 않는다. 본문은 14px/1.6, 제목 위계는 600~700 굵기와 크기로만 만든다.
- 기준 radius는 `0.625rem`; 패널 `0.625rem`, 버튼·입력 `0.5rem`, 작은 컨트롤 `0.375rem`, 배지는 pill이다.
- 경계는 1px이다. 특히 다크 모드의 일반 경계와 사이드바 경계는 7% 흰색 헤어라인을 유지한다.
- 그림자로 면을 띄우지 않는다. 포커스는 `--ring` 아웃라인으로 명확히 표시한다.

## 레이아웃과 사이드바

- 데스크톱은 200px 사이드바와 최대 860px 본문을 사용한다. 본문 패딩은 32px이다.
- 사이드바는 `--sidebar` 면과 `--sidebar-border` 1px 경계로 본문과 나눈다.
- 내비게이션 기본 상태는 `--muted-foreground`, hover는 `--accent` 면과 `--foreground` 텍스트다.
- 활성 항목은 `--secondary` 면과 `--foreground` 텍스트를 쓰고, 왼쪽 2px `--ai-action-accent` 인디케이터만 violet으로 표시한다. 글로우는 금지한다.
- 720px 이하에서는 기존 동작대로 사이드바를 상단 가로 바로 바꾸고 활성 인디케이터를 아래쪽으로 이동한다. 기능과 탭 순서는 바꾸지 않는다.

## 컴포넌트

### 버튼

- primary: `--primary` 채움, `--primary-foreground` 텍스트, 같은 색 경계. 굵기 600.
- 기본: `--card` 면, `--border` 경계, `--foreground` 텍스트. hover는 `--accent` 면.
- quiet: 투명 경계와 `--muted-foreground` 텍스트. hover에서만 `--accent` 면과 `--foreground` 텍스트.
- danger는 기본 형태를 유지하고 hover/focus에서 `--destructive`로 위험을 알린다.
- disabled는 투명도를 낮추고 포인터를 비활성화한다.

### 카드와 패널

- 카드·모달은 `--card`, 1px `--border`, `0.625rem` radius를 사용한다.
- 카드 안의 fact, 폴더 목록, 프리플라이트, 그래프 무대는 `--secondary` 또는 `--background`로 한 단계만 구분한다.
- 다음 행동 카드의 강조는 violet 채움이 아니라 `--ring` 경계로 처리한다.
- 성공 배너만 success 10% 배경과 25% 경계를 허용한다.

### 배지

- pill 형태, 1px `--border`, 작은 `--muted-foreground` 텍스트가 기본이다.
- 성공은 `--status-success`, 모순·실패는 `--destructive`, 중복·확인 필요는 `--status-warning`을 쓴다.
- 비활성/지난 기억은 점선 경계와 muted 텍스트를 쓴다.

### 입력

- 배경은 `--background`, 경계는 `--input`, 텍스트는 `--foreground`다.
- focus는 `--ring` 1px 아웃라인으로 표시한다. violet focus 링은 쓰지 않는다.
- checkbox와 radio는 중성 `--primary`를 사용한다.

### 모달과 토스트

- 모달 오버레이는 `rgb(0 0 0 / 0.5)` 표준 스크림이다.
- 모달 패널은 카드 규칙을 따른다. 코드/미리보기 영역은 mono 스택을 사용한다.
- 토스트는 카드 면과 경계를 사용하고, 왼쪽 상태선만 성공 또는 위험 색으로 구분한다.

## 그래프 뷰

- canvas 기반 force-directed 구조, 줌·팬·hover·클릭·약 3초 감쇠 동작은 유지한다.
- 스코프 허브는 `--primary`, fact 노드는 `--muted-foreground`, 라벨은 `--foreground`를 쓴다. 스코프별 임의 팔레트는 사용하지 않는다.
- 일반 스코프 엣지는 `--border` 헤어라인이다. 다크에서는 정확히 7% 흰색이다.
- `superseded_by` 엣지와 hover 표시는 `--ai-action-accent`, 모순 엣지는 `--destructive`, 중복 엣지는 `--status-warning`이다.
- 캔버스는 하드코딩 색을 갖지 않는다. 렌더링 시 `getComputedStyle(document.documentElement)`로 그래프 CSS 변수를 읽고 시스템 테마 변경 시 다시 그린다.
- 범례 순서는 허브=프로젝트 · 보라=대체 · 빨강=모순 · 노랑=중복 확인 필요를 유지한다.
- 빈 상태 카피와 설정 이동 액션은 기존 그대로 유지한다.

## 불변

기존 기능·플로우·한국어 카피·API 계약·상태머신·이벤트 바인딩을 바꾸지 않는다. 모든 `id`, 기존 클래스, `data-*` 속성을 보존한다. 테스트 앵커도 그대로 유지한다: `id="pending-badge"`, `setChrome()`, `id="manual-copy"`, `클립보드 복사에 실패했어요`, `attempt<120`, `소화 중… 최대 2분`, `finally{if(button.isConnected)`, `checkup-slot`, `중복·모순 판정`.
