# 토론 반영 요약 (수용/기각 + 이유)

## ✅ 수용 (반영)

| 지적 (출처) | 반영 방식 |
|---|---|
| "3/12 · 9개 남음"이 상단에 항상 보였으면 (유저) | **앱바 우측 진행 pill**로 상시 노출 — 별도 페이지 이동 없이 시각적 앵커. |
| 리뷰가 여러 카드로 쌓이면 시작부터 피곤 (유저) | 앱바의 진행 pill을 **탭 시 리뷰 세션 진입** 진입점으로 통합. 랜딩에서 카드 스택 없앰. |
| `확신 87%`는 판단 못 도와주고 오히려 AI 따라 누르게 만듦 (유저) | **삭제.** 앱바·검색·진행 표시 어디에도 % 노출 금지. |
| id/status/superseded_by 같은 내부 필드 (유저) | **사람말 치환.** 검색 결과에 "7월 9일 A → 7월 12일 B로 바뀜" 서사식 라벨만. |
| 기억 어디에서 왔는지 (프로젝트·대화·노트) 확인 (유저) | 검색 결과 각 행에 **출처 배지**(project 슬러그 + 소스 종류 아이콘: 대화/노트/결정). |
| 검색에서 지난 7일·프로젝트 필터 (유저) | **⌘K 팔레트 상단에 필터 chip 2종**(기간, 프로젝트). 기본 기간=지난 30일 · 기본 프로젝트=현재 컨텍스트. |
| "지난 기억 포함"을 유저가 켜야 하는 건 놓치기 쉬움 (유저) | **디폴트 ON**(superseded 포함). 대신 결과 행에 "🕓 지난 결정" 배지로 시각 구분. |
| 완료 후에도 설정 메뉴가 눈에 띄는 것 (유저) | 앱바에서 **설정은 오버플로 메뉴(⋯)에 격납**, 기본 노출 아이콘 최소 2개(검색·리뷰). |
| 그래프/공유 이미지/X 문구 (유저) | 앱바 진입점에서 **완전 제거**. |
| 리뷰 진행 표시 · 검색 · 앱바를 개별 페이지가 아니라 한 셸에 (UX 전문가 추정 지적: 컨텍스트 전환 최소화) | 앱바는 sticky, ⌘K는 모달, 진행 pill은 앱바 인라인 — **전부 같은 셸에서 인스턴트 오픈/클로즈**. |
| WKWebView 좌측 트래픽라이트 겹침 위험 (환경 제약) | 앱바 좌측 padding 80px를 **JS 감지 없이 CSS env() + 폴백**으로 처리. |

## ❌ 기각 (반영 안 함)

| 지적 | 기각 이유 |
|---|---|
| "숫자 키·방향키로 답하고 다음 질문으로 즉시" (유저) | **범위 밖.** 리뷰 카드 인터랙션은 이번 스펙(앱바·⌘K·진행표시)에 없다. 단, **⌘K 팔레트 내부 키보드**는 살린다(↑↓/Enter/Esc/⌘K 재토글). |
| "합치기 후 이 문장이 남습니다 미리보기" (유저) | **범위 밖.** 리뷰 카드 로직. 진행 pill의 tooltip에 "정리 N개" 카운터로만 남긴다. |
| "완료 요약: 12개 완료 · 5개 정리 · 3개 수정 · 4개 나중에" (유저) | **범위 안이나 축소 반영.** 앱바 pill이 리뷰 종료 시 **요약 상태로 전환**(4개 숫자 인라인). 별도 완료 페이지 안 만듦. |
| 앱바에 검색바 상시 노출 vs ⌘K 트리거만 (전문가 관점 가정) | **⌘K 트리거만 유지.** 상시 검색바는 좌측 트래픽라이트/타이틀바 폭을 잡아먹고, 유저의 주 진입은 알림→리뷰 흐름이지 검색이 아님. 검색은 오후 회고용 — 아이콘+단축키로 충분. |
| 다크/라이트 자동 토글 UI (전문가 관점 가정) | **OS prefers-color-scheme 자동만.** 앱바에 토글 버튼 없음. Orca 토큰이 미디어쿼리로 자동 전환. |
| 아바타/계정 메뉴 (일반 관행) | **없음.** 단일 유저 로컬 앱 컨텍스트. 오버플로 메뉴 안으로. |

## ⚖️ 충돌 디렉터 판단

- **"진행 pill을 앱바에 vs 리뷰 페이지에만"** → **앱바.** 유저는 알림→클릭→3분 안에 끝내려 함. 앱바에 있으면 화면 전환 없이 자기 위치를 알 수 있고, 리뷰 안 하는 시간에도 "12개 대기" 상태 힌트를 준다. 리뷰가 0일 땐 pill 숨김(잔상 방지).
- **"⌘K vs 별도 검색 페이지"** → **⌘K 모달.** Claude Code/Raycast 근접 사용자라 학습 비용 0. 브라우저에서도 keydown('k' + meta/ctrl)으로 동등 트리거.
- **"검색 결과에서 원문 소스로 딥링크 vs 요약만"** → **딥링크 우선.** 유저가 "결국 Claude나 옵시디언을 따로 뒤진다"고 지적. 프로젝트 슬러그 + 소스 URL 있으면 새 창/외부 URL로 여는 버튼 노출. 없으면 배지만.

---

# 최종 UI/UX 스펙 (codex 구현용)

## 0. 공통 전제

- **파일:** `src/dashboard/public.js` 단일 템플릿 리터럴. HTML/CSS/JS를 한 문자열 안에서 다룬다. 새 파일·번들러·프레임워크 도입 금지.
- **엔드포인트:** 기존 `GET /api/memory?q=<query>&scope=<project>&since=<iso>&includeSuperseded=true` 만 사용. **신규 백엔드 금지.**
- **디자인 토큰:** `docs/DESIGN-dashboard.md v3` 참조.
  - `--bg-base` / `--bg-elevated` / `--fg-primary` / `--fg-muted` — Orca 다크·라이트
  - `--hairline`: 7% alpha 경계선 (border, divider 전용)
  - `--violet-progress`: 진행 표시 전용 (AI가 뭔가 처리 중일 때만)
  - **금지:** 새로운 색상/폰트/radius/그림자 발명. 기존 토큰 이름만 그대로.
- **테마 스위칭:** `@media (prefers-color-scheme: dark)`만. JS 토글 없음.
- **모션:** 모든 트랜지션 120ms `cubic-bezier(.2,.7,.2,1)`. 진행 pill 카운터 증감은 트랜지션 없음(숫자 튀는 게 정확함).

## 1. 상단 앱바 (`<header id="appbar">`)

### 레이아웃 (좌→우)

```
[ 80px 트래픽라이트 영역 ][ 타이틀 "nautli" ]  ────────────  [ 진행 pill ][ ⌘K 아이콘 ][ ⋯ 오버플로 ]
```

### DOM 구조

```html
<header id="appbar" data-native="auto">
  <div class="appbar-left">
    <span class="appbar-title">nautli</span>
  </div>
  <nav class="appbar-right">
    <button id="review-pill" class="pill" hidden>
      <span class="pill-progress"></span>
      <span class="pill-text">12개 대기</span>
    </button>
    <button id="cmdk-trigger" class="icon-btn" aria-label="검색 (⌘K)">
      <svg><!-- search icon --></svg>
      <kbd>⌘K</kbd>
    </button>
    <button id="overflow" class="icon-btn" aria-label="더보기">⋯</button>
  </nav>
</header>
```

### CSS

```css
#appbar {
  position: sticky; top: 0; z-index: 10;
  height: 44px;
  display: flex; align-items: center; justify-content: space-between;
  padding-left: max(80px, env(titlebar-area-x, 80px));
  padding-right: 12px;
  background: var(--bg-base);
  border-bottom: 1px solid var(--hairline);
  -webkit-app-region: drag; /* WKWebView 드래그 */
  user-select: none;
}
#appbar button, #appbar kbd { -webkit-app-region: no-drag; }

.appbar-title {
  font-size: 13px; font-weight: 500; color: var(--fg-muted);
  letter-spacing: 0.02em;
}
.appbar-right { display: flex; gap: 4px; align-items: center; }

.icon-btn {
  height: 28px; padding: 0 8px;
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent; border: 1px solid transparent; border-radius: 6px;
  color: var(--fg-muted); cursor: pointer;
}
.icon-btn:hover { background: var(--bg-elevated); color: var(--fg-primary); }
.icon-btn kbd {
  font: 11px/1 ui-monospace, monospace;
  padding: 2px 5px; border: 1px solid var(--hairline); border-radius: 4px;
  color: var(--fg-muted);
}
```

### 진행 pill (`#review-pill`)

- **상태 3종:**
  1. **hidden**: 대기 리뷰 0개 → `hidden` 속성 부여
  2. **pending**: 대기 N개 → `12개 대기` 텍스트, 좌측 도트 회색(`--fg-muted`)
  3. **in-progress**: 리뷰 중 → `3/12` + 얇은 progress bar (하단 2px, `--violet-progress`)
  4. **completed**: 방금 세션 종료 → 5초간 `12개 완료 · 5정리 · 3수정 · 4나중에` 표시 후 자동 hidden

```css
.pill {
  height: 28px; padding: 0 12px;
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--hairline); border-radius: 999px;
  color: var(--fg-primary); font-size: 12px;
  position: relative; overflow: hidden;
}
.pill[data-state="in-progress"] .pill-progress {
  position: absolute; left: 0; bottom: 0; height: 2px;
  background: var(--violet-progress);
  width: calc(var(--pct) * 1%);
}
.pill[data-state="pending"] .pill-progress {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--fg-muted); position: static;
}
```

- **클릭:** `#review-pill` 클릭 → 리뷰 세션 진입 (이번 스펙 밖 컴포넌트로 이벤트 dispatch `CustomEvent('nautli:review-open')`).
- **데이터 소스:** 페이지 로드 시 `GET /api/memory?q=&pendingReviewOnly=1`(**기존 파라미터로 대체 가능하면 그걸 재사용**, 없으면 pill을 빈 상태로 두고 별도 이벤트로 채우는 훅만 열어둔다 — 신규 엔드포인트 금지). 폴링 없음, 서버 이벤트나 리뷰 종료 이벤트 시에만 업데이트.

### 오버플로 메뉴 (`#overflow`)

- 클릭 시 앱바 우측 아래로 팝오버.
- 항목: `테마: 시스템` (읽기 전용 표시), `설정`, `버전`. **아바타·공유·그래프 없음.**

### WKWebView vs 브라우저 분기

- **CSS만으로 해결:** `env(titlebar-area-x)`는 WKWebView에서만 값이 있으므로 폴백 80px.
- 브라우저에서는 좌측 80px가 빈 여백으로 보이나, 타이틀 텍스트가 그 뒤에 붙어 있어 시각적으로 문제 없음. JS 감지 코드 넣지 않음.

## 2. ⌘K 검색 팔레트 (`<dialog id="cmdk">`)

### 트리거

```js
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    document.getElementById('cmdk').showModal();
    document.getElementById('cmdk-input').focus();
  }
});
document.getElementById('cmdk-trigger').addEventListener('click', () => {
  document.getElementById('cmdk').showModal();
  document.getElementById('cmdk-input').focus();
});
```

- **native `<dialog>` 사용** (WKWebView·최신 크롬 지원 확인). backdrop은 CSS로 어둡게.

### DOM 구조

```html
<dialog id="cmdk">
  <form method="dialog" class="cmdk-shell">
    <input id="cmdk-input" placeholder="기억 검색… (예: 결제 재시도)" autocomplete="off" />
    <div class="cmdk-filters">
      <button type="button" class="chip" data-filter="since" data-value="7d">지난 7일</button>
      <button type="button" class="chip" data-filter="since" data-value="30d" data-active>지난 30일</button>
      <button type="button" class="chip" data-filter="since" data-value="all">전체</button>
      <span class="chip-sep"></span>
      <button type="button" class="chip chip-project" data-filter="project">프로젝트: 전체 ▾</button>
    </div>
    <ul id="cmdk-results" role="listbox"></ul>
    <footer class="cmdk-footer">
      <span><kbd>↑</kbd><kbd>↓</kbd> 이동</span>
      <span><kbd>Enter</kbd> 열기</span>
      <span><kbd>Esc</kbd> 닫기</span>
    </footer>
  </form>
</dialog>
```

### 결과 행 구조 (재사용성 위해 단순화)

```html
<li role="option" data-source-url="obsidian://…" tabindex="0">
  <div class="row-main">
    <span class="row-title">결제 재시도 3회로 상향</span>
    <span class="row-date">7월 12일</span>
  </div>
  <div class="row-meta">
    <span class="badge badge-project">bridgr</span>
    <span class="badge badge-source">💬 대화</span>
    <span class="badge badge-superseded">🕓 지난 결정</span>   <!-- superseded일 때만 -->
  </div>
  <div class="row-history">7월 9일 5회 → 7월 12일 3회로 바뀜</div>  <!-- 이력 있을 때만 -->
</li>
```

### CSS

```css
#cmdk {
  width: min(640px, 90vw); max-height: 60vh;
  padding: 0; border: 1px solid var(--hairline); border-radius: 12px;
  background: var(--bg-elevated); color: var(--fg-primary);
  box-shadow: 0 20px 60px rgba(0,0,0,.35);
}
#cmdk::backdrop { background: rgba(0,0,0,.5); backdrop-filter: blur(2px); }
.cmdk-shell { display: flex; flex-direction: column; max-height: 60vh; }

#cmdk-input {
  height: 48px; padding: 0 16px;
  border: 0; border-bottom: 1px solid var(--hairline);
  background: transparent; color: inherit; font-size: 15px; outline: none;
}
.cmdk-filters {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; border-bottom: 1px solid var(--hairline);
  overflow-x: auto;
}
.chip {
  height: 24px; padding: 0 10px;
  background: transparent; border: 1px solid var(--hairline); border-radius: 999px;
  color: var(--fg-muted); font-size: 12px; cursor: pointer; white-space: nowrap;
}
.chip[data-active] { background: var(--bg-base); color: var(--fg-primary); border-color: var(--fg-primary); }
.chip-sep { width: 1px; height: 16px; background: var(--hairline); margin: 0 4px; }

#cmdk-results { list-style: none; margin: 0; padding: 4px 0; overflow-y: auto; }
#cmdk-results li {
  padding: 10px 16px; cursor: pointer; border-radius: 6px; margin: 0 4px;
}
#cmdk-results li:hover, #cmdk-results li[aria-selected="true"] {
  background: var(--bg-base);
}
.row-main { display: flex; justify-content: space-between; align-items: baseline; }
.row-title { font-size: 14px; }
.row-date { font-size: 12px; color: var(--fg-muted); }
.row-meta { display: flex; gap: 6px; margin-top: 4px; }
.badge {
  font-size: 11px; padding: 1px 6px; border-radius: 4px;
  background: var(--bg-base); color: var(--fg-muted); border: 1px solid var(--hairline);
}
.badge-superseded { color: var(--fg-muted); font-style: italic; }
.row-history {
  margin-top: 6px; font-size: 12px; color: var(--fg-muted);
  padding-left: 8px; border-left: 2px solid var(--hairline);
}
.cmdk-footer {
  display: flex; gap: 16px; padding: 8px 16px;
  border-top: 1px solid var(--hairline);
  font-size: 11px; color: var(--fg-muted);
}
.cmdk-footer kbd {
  padding: 1px 4px; border: 1px solid var(--hairline); border-radius: 3px;
  font: 10px/1 ui-monospace, monospace;
}
```

### 검색 동작

- **디바운스 180ms.** 입력 후 대기.
- 쿼리 구성:
  ```
  /api/memory?q=<q>&since=<7d|30d|all>&scope=<project|all>&includeSuperseded=true&limit=20
  ```
- **includeSuperseded는 항상 true**로 보냄. 결과에서 `superseded_by`가 있으면 `.badge-superseded` 붙임.
- **응답 매핑 (프론트에서 변환):**
  - `created_at` ISO → "7월 12일" 형식 (당해년도면 월·일만, 다른 해면 "2025년 7월 12일")
  - `superseded_by` 있으면 → 서버가 이미 `history: [{date, claim}]` 배열을 함께 준다고 가정 (기존 응답 스키마 확인 필요, 없으면 `.row-history` 생략). **없다고 신규 필드 요구 금지** — 있으면 쓰고 없으면 뺀다.
  - `source_url` 있으면 → 클릭 시 `window.open(source_url, '_blank')`
  - `project`/`scope`가 `project:xxx` 형태면 슬러그만 추출해 badge에.
  - `source_type` → 아이콘 매핑: 대화=💬, 노트=📝, 결정=✅ (없으면 배지 생략).

### 키보드

| 키 | 동작 |
|---|---|
| `⌘K` / `Ctrl+K` | 열기/닫기 토글 |
| `↑` `↓` | 결과 이동 (`aria-selected` 갱신) |
| `Enter` | 선택 항목 열기 (source_url 있으면 새 창, 없으면 세부 확장 — 이번 스펙에선 새 창만) |
| `Esc` | 닫기 |
| `Tab` | filter chip으로 포커스 이동 |

### 상태

- **초기(쿼리 비어있음):** 결과 리스트 자리에 안내: "최근 결정 · 노트 · 대화를 검색해요. `프로젝트` 이름이나 `결제 재시도` 같은 단어로 시작하세요."
- **로딩:** 결과 영역 상단 얇은 2px 라인 `--violet-progress` 무한 애니메이션 (검색 = AI 진행 아님이므로 **violet 대신 `--fg-muted`로 잔잔한 슬라이드**). ← 디렉터 결정: violet 오남용 금지 원칙.
- **빈 결과:** "일치하는 기억이 없어요. 필터를 넓혀 보세요." + 활성 필터 chip 초기화 버튼.
- **에러:** "검색을 못 불러왔어요. 다시 시도" + 재시도 버튼. 상세 에러코드 노출 금지.

## 3. 리뷰 진행 표시

- 위 1절의 `#review-pill`이 유일한 진행 표시. **별도 컴포넌트/페이지 없음.**
- 리뷰 세션 진입은 pill 클릭으로 `CustomEvent('nautli:review-open')` dispatch. **리뷰 카드 UI는 이번 스펙 밖.** 이 이벤트를 리스닝하는 쪽이 향후 별 스펙으로.
- 완료 시 dispatch될 이벤트 계약(문서화):
  ```js
  window.dispatchEvent(new CustomEvent('nautli:review-progress', {
    detail: { done: 3, total: 12, tallies: { organized: 5, edited: 3, postponed: 4 } }
  }));
  ```
- pill은 이 이벤트만 구독. **폴링·별도 fetch 금지.**

---

# 구현 시 반드시 지킬 체크리스트

## 파일·구조
- [ ] `src/dashboard/public.js` 하나의 템플릿 리터럴 안에서 HTML+CSS+JS 모두 완성. 새 파일 만들지 않는다.
- [ ] 신규 백엔드 엔드포인트 0건. `/api/memory?q=…` 기존 파라미터만 사용.
- [ ] 응답 스키마에 없는 필드(예: `history`)는 있으면 렌더, 없으면 조용히 생략. 서버 변경 요청 금지.

## 디자인 토큰
- [ ] 색·폰트·radius·그림자를 새로 정의하지 않고 `docs/DESIGN-dashboard.md v3` 토큰 이름만 사용.
- [ ] `--violet-progress`는 **리뷰 pill의 in-progress 바에만** 사용. 검색 로딩 인디케이터는 `--fg-muted`.
- [ ] 모든 divider·border는 `var(--hairline)` (7% alpha). 진한 border 금지.
- [ ] 다크/라이트 전환은 `prefers-color-scheme` 자동만. JS 토글 없음.

## 앱바
- [ ] 좌측 padding `max(80px, env(titlebar-area-x, 80px))`.
- [ ] `-webkit-app-region: drag` on `#appbar`, `no-drag` on 모든 버튼/kbd.
- [ ] pill의 4상태(`hidden`/`pending`/`in-progress`/`completed`) 전부 스타일 정의.
- [ ] pill 클릭 시 `CustomEvent('nautli:review-open')` dispatch.
- [ ] 오버플로 메뉴에 **아바타/공유/그래프/테마토글 넣지 않기.**

## ⌘K
- [ ] `<dialog>` element 사용, `showModal()` / `close()`.
- [ ] ⌘K + Ctrl+K 둘 다 트리거 (Mac/Win 겸용).
- [ ] 디바운스 180ms.
- [ ] `includeSuperseded=true` 항상 전송, 결과에 배지로 시각 구분.
- [ ] 결과 행에 **내부 필드(id, status, superseded_by 원문) 노출 금지.** 사람말 라벨만.
- [ ] 확신 % 표시 금지.
- [ ] 키보드 4종(↑↓/Enter/Esc/⌘K) 전부 동작.
- [ ] 초기/로딩/빈결과/에러 4상태 모두 UI 정의.
- [ ] 필터 chip 활성 상태는 `data-active` 속성 + `aria-pressed`.

## 진행 표시
- [ ] pill 상태는 `nautli:review-progress` CustomEvent 리스너로만 갱신. 폴링/독립 fetch 금지.
- [ ] 대기 0개 → 자동 `hidden`. UI에 "0/0" 잔상 남기지 않기.
- [ ] 완료 상태 5초 후 자동 사라짐(`setTimeout`).
- [ ] 완료 요약은 `12개 완료 · 5정리 · 3수정 · 4나중에` 순서·구분자 고정.

## WKWebView / 브라우저
- [ ] Safari WKWebView(macOS)에서 트래픽라이트와 텍스트 겹침 없는지 시각 확인.
- [ ] 크롬/사파리 일반 브라우저에서 좌측 80px 빈 여백이 부자연스럽지 않은지 확인 (타이틀 텍스트로 채워짐).
- [ ] `<dialog>` polyfill 없이 최신 WebKit·Chromium에서 열림 확인.
- [ ] JS 환경 분기(`navigator.userAgent` 검사) 넣지 않음 — CSS `env()` 폴백으로 해결.

## 접근성
- [ ] pill·icon-btn 모두 `aria-label` 부여.
- [ ] `<dialog>` 열림 시 첫 포커스 = `#cmdk-input`.
- [ ] 포커스 링 제거하지 않기(WKWebView 기본 아웃라인 유지 or `--fg-primary` 1px).
- [ ] 결과 리스트 `role="listbox"`, 행 `role="option"`, 선택된 행 `aria-selected="true"`.

## 비주얼 QA (구현 후 필수)
- [ ] `qc98` 트리거: 다크/라이트 각각 스크린샷 → 겹침·잘림·정렬·상태누수 6종 판정.
- [ ] pill 4상태 각 상태 스크린샷 (in-progress 25%/50%/75%도).
- [ ] ⌘K 4상태(초기/로딩/결과/빈/에러) 각 스크린샷.
- [ ] WKWebView 좌측 트래픽라이트 겹침 없음 스크린샷 캡처.
