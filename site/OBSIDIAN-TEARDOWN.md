# obsidian.md 코드 해부 → nautli.ai 적용 (2026-07-19)

원본: `https://obsidian.md/` (HTML 98KB) + `/tailwind.css?v=4156f0de` (149KB, Tailwind 3 빌드본).
목적은 룩앤필 복제가 아니라 **구조/타이포/자산 전략의 이식**이다. 브랜드 토큰(Ink/Teal)은 `DESIGN.md`가 정본이며 바뀌지 않는다.

## 1. 관측한 것 (코드 근거)

### 1.1 팔레트 — 다크 전용, 액센트 1개
```
--color-primary:   #0F0F0F   /* body 배경 */
--color-secondary: #1F1F1F   /* 카드 */
--color-accent-600:#7C3AED   /* 주 CTA */
--color-accent-500:#8B5CF6   /* 링크 */
--color-accent-400:#A78BFA   /* 링크 hover */
.text-normal #E5E5E5 / .text-muted #BCBCBC / .text-faint #A3A3A3
```
라이트 모드가 아예 없다. 위계는 색이 아니라 **밝기 3단(normal/muted/faint)** 으로만 만든다.

### 1.2 컨테이너 — 전 구간 하나
```css
.container { margin-inline: auto; width: 70rem; max-width: 90%; }
```
섹션마다 폭을 바꾸지 않는다. 세로 리듬은 `py-16 sm:py-24`(64/96px) 하나로 반복.

### 1.3 타이포 — 셀프호스트 + 서브셋
```css
@font-face { font-family:'Inter'; font-weight:400; src:url('/fonts/Inter-Regular.woff2');
             unicode-range: U+00-FF; }   /* 400·500·600·700 각각 */
```
`unicode-range`로 **라틴만** 싣고 나머지는 시스템 폰트로 흘린다. CDN 의존 0.
```css
.text-title { font-size:2.75rem; line-height:1.1; letter-spacing:-0.02em;
              font-weight:600; text-wrap:balance; }
@media (min-width:640px){ .text-title{ font-size:3.75rem; line-height:1; } }
:root { text-wrap: pretty; }
```
히어로 h1만 예외로 `text-[13vw]` → 모바일에서 화면폭에 딱 맞게 커진다.

### 1.4 섹션 헤딩 패턴
```html
<h2 class="text-title mb-4">Spark ideas.</h2>
<p class="text-xl text-muted sm:text-2xl">From personal notes to journaling, …</p>
```
대문자 eyebrow 라벨이 없다. **짧은 명령형 제목 + 마침표**, 그 아래 큰 muted 문단, 그 안에 인라인 액센트 링크. 위계가 두 단계뿐이라 스캔이 빠르다.

### 1.5 히어로 비주얼 = 손으로 짠 앱 목업 (스크린샷 아님)
```html
<div class="mock-overflow">
  <div class="relative w-[56rem] max-w-none md:w-auto">
    <div class="app-window">
      <div class="app-titlebar">
        <div class="mock-macos-dots">…</div>
        <div class="app-tab is-active"><span>Writing is telepathy</span></div>
      </div>
      <div class="app-sidebar">…</div>
```
```css
.app-window   { background:#1e1e1e; border:1px solid #363636; color:#dadada; }
.app-titlebar { height:38px; background:#262626; }
.app-sidebar  { background:#262626; border-inline-end:1px solid #363636; font-size:13px; }
```
전부 DOM이다. 밀도 무관 선명, 페이지와 함께 현지화, 이미지 바이트 0. 일부 문단은 `contenteditable`이라 살아있는 느낌을 준다. `aria-hidden` + `data-nosnippet`.

### 1.6 텍스처 — 딱 한 곳
```css
.bg-basalt:before {
  content:""; position:absolute; inset:0; z-index:-1;
  background: var(--grain); background-size:100px;
  mix-blend-mode: screen;
  mask-image: radial-gradient(ellipse closest-side at 70% 45%, rgba(0,0,0,.15), transparent 100% 150%);
}
```
평평한 색 띠 대신 **마스킹된 필름 그레인**. 그라데이션·글래스모피즘은 없다.

### 1.7 카드 — 테두리 대신 인셋 링, 1.2% hover
```html
<div class="card card-shimmer card-grow ring-1 ring-inset ring-white/5 bg-secondary rounded-xl p-6">
```
```css
.card-grow:hover { --tw-scale-x:1.012; --tw-scale-y:1.012; }  /* 150ms */
```

### 1.8 기타
- 헤더: `position:fixed`, `--header-height:60px`, 처음엔 투명 → 스크롤 시 배경·보더가 `.25s`로 들어옴.
- 자산 캐시버스팅: `<link href="/tailwind.css?v=4156f0de">`.
- 스크린샷은 아래쪽을 `bg-gradient-to-t from-primary`로 페이드시켜 페이지에 녹인다.
- 페이지 전체가 히어로 + 기능 3블록 + CTA + 푸터. h2가 4개뿐이다.

## 2. nautli에 적용한 것

| # | 이식한 패턴 | nautli 구현 |
|---|---|---|
| 1 | Inter 셀프호스트 + unicode-range | `src/fonts/Inter-{400,500,600,700}.woff2` (라틴 서브셋, 각 ~24KB). KO/JA는 시스템 스택으로 흘림 |
| 2 | 단일 컨테이너 | `.wide-shell`을 `min(90%, 1080px)` 하나로 통일 (기존 960px 고정) |
| 3 | 타이틀 스케일 + text-wrap | h1 `clamp(38px, 11vw, 60px)`, h2 `clamp(30px, 4.4vw, 44px)` + `balance`, 루트 `pretty` |
| 4 | 큰 muted 서브헤드 | `.hero-subline` / `.section-intro`를 18px 고정 → `clamp(19px, 2.2vw, 26px)` |
| 5 | 손으로 짠 제품 목업 | `appMock()` — 밤사이 정리 화면(범위 사이드바 · 모순 리뷰카드 · 사실 목록). 3개어 현지화, `aria-hidden`+`data-nosnippet` |
| 6 | 마스킹 그레인 | `.grain-surface::before`, feTurbulence 데이터 URI. 라이트=multiply, 다크=screen |
| 7 | 카드 hover 1.012 | `.card`·`.boundary-card`·`.review-card`·`.community-block`, `prefers-reduced-motion` 해제 포함 |
| 8 | 스티키 헤더 스크롤 상태 | `position:sticky` + `main.js`가 `scrollY>8`에서 `.is-scrolled` 토글 → 보더만 켜짐 |
| 9 | 자산 캐시버스팅 | `build.mjs`가 sha256 8자리를 계산해 `style.css?v=…` / `main.js?v=…` |

## 3. 의도적으로 안 가져온 것

- **다크 전용**: nautli는 라이트 우선(`DESIGN.md`)이다. 두 테마 다 유지하고, 목업 창만 항상 다크 크롬으로 둔다 — 터미널 옆에 사는 도구를 라이트로 그리면 거짓말이다.
- **보라 액센트**: 브랜드 킷상 Teal 하나. `⛔ warm clay-orange 금지` 규칙도 그대로.
- **eyebrow 라벨 제거**: nautli의 "문서 같은 랜딩" 콘셉트에서 섹션 라벨은 유지 가치가 있다고 판단. 대신 서브헤드를 키워 위계를 두 단계로 좁혔다.
- **card-shimmer**: 장식 애니메이션. "화려한 그라데이션 금지" 원칙과 충돌.

## 4. 검증

- `node build.mjs` 통과, `dist/fonts/` 4개 배포 확인.
- 로컬 4630에서 데스크탑(1280) 라이트/다크, 모바일(375) 실렌더 확인.
- ⚠️ 브라우저 프리뷰 스크린샷은 `scrollTop>0`에서 어긋난 프레임을 잡는다. 검안은 `scrollTop=0` + 앞 섹션 임시 `display:none`으로 할 것.
