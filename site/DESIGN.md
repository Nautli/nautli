# nautli.ai 랜딩 DESIGN 토큰 v3 (웹사이트 비주얼 SSOT — 토큰 외 색/폰트 발명 금지)

> v2(2026-07-19): obsidian.md 코드 해부 결과를 이식. 해부 근거·미채택 항목은 `OBSIDIAN-TEARDOWN.md`.
> v2.1(2026-07-19): 메인 액센트를 Teal에서 **Neon Green**으로 교체(유저 지시). 색상은 172도→162도로 8도만 옮겨 기존 나선 마크와 같은 계열을 유지한다.
> v3(2026-07-19): **다크 전용**으로 전환(유저 지시, obsidian.md 방식). 라이트 브랜치·테마 토글 삭제.

> 대상: 공개 마케팅/온보딩 웹사이트(nautli.ai). 로컬 대시보드(docs/DESIGN-dashboard.md, 다크 Orca)와 별개 표면 — 단 브랜드 킷은 공유.
> 브랜드 정본 = `assets/brand/` (원본: ~/Desktop/brand-logos/FINAL/nautli/). ⛔ warm clay-orange/cream 절대 금지.

## 콘셉트
"기록은 오래 산다" — 앵무조개(수억 년 살아남은 나선)의 정적이고 단단한 느낌. 개발자 대상이므로 과장 없는 문서 같은 랜딩. 화려한 그라데이션·글래스모피즘 금지.

## 컬러 (다크 전용)

라이트 모드는 없다. obsidian.md와 같은 선택 — 테마가 하나면 **모든 표면 조합을 실제로 검증할 수 있다**. 두 테마를 유지하면 검증해야 할 조합이 두 배가 되고, 실제로는 한쪽만 보게 된다.

```
--bg:         #141414   배경
--bg-card:    #1c1c1a   카드
--border:     #2a2a27
--text:       #F7F7F5   본문·제목        (17.17:1 AAA)
--text-dim:   #a3a39e   보조 설명        ( 7.27:1 AAA)
--text-faint: #87877f   메타·라벨·캡션   ( 5.09:1 AA, 카드 위 4.72 AA)
--neon / --accent / --accent-fill: #00E6A1   (11.26:1 AAA)
--accent-on-fill: #141414   채움 위 글자
--accent-soft:    #00E6A114 배경 틴트
```

**위계는 색이 아니라 밝기 3단으로만 만든다.** 액센트는 하나, 보조 액센트 금지. 새 색을 만들지 말고 text / dim / faint 중에서 골라라.
`--text-faint`는 "안 읽혀도 되는 층"이 아니다 — 카드 위에서도 AA(4.72)를 지킨다. 이 밑으로 더 흐린 4단째를 만들지 마라.

### ⛔ 네온은 채움색이다 (불변식)
`--neon`/`--accent-fill`을 **라이트 배경 위 텍스트 색으로 쓰지 마라** — `#F7F7F5` 위 대비 1.55:1로 안 읽힌다. 규칙:
- 텍스트·링크·아이콘 = `--accent` (테마별로 라이트는 깊은 초록, 다크는 네온)
- 채워진 표면(버튼·칩·skip-link) = `--accent-fill` 배경 + `--accent-on-fill` 글자. 흰 글자 금지
- 액센트는 **하나만**. 보조 액센트 색을 추가하지 마라

### 테마 토글 없음
`<html data-theme="dark">`로 고정, `<meta name="color-scheme" content="dark">`. 헤더의 토글 버튼과 `main.js`의 테마 로직·localStorage는 제거했다. 다시 넣지 마라 — 고를 게 하나면 컨트롤도 없어야 한다.

### 브랜드 자산 동기화
`assets/brand/`(파비콘·OG)는 아직 구 Teal(#087A6B/#12A88F)이다. 색상 계열이 같아 당장 튀지는 않지만 **정본 킷(`~/Desktop/brand-logos/FINAL/nautli/`) 재생성 전까지는 사이트가 앞서 있는 상태**임을 알고 있어라(TASK-064). 재생성 시 **다크 배경 기준**으로 볼 것. ⛔ warm clay-orange/cream 금지는 그대로 유효.

## 형태
- radius: 카드 12px, 버튼 8px, 코드블록 8px (제품 대시보드와 통일)
- 카드: --bg-card + 1px --border, 그림자 없음(플랫)
- 주 CTA 버튼: --accent 배경 + #F7F7F5 글자. 보조: 투명 + 1px --border
- 간격 4px 배수. **넓은 컨테이너는 `min(90%, 1080px)` 하나로 통일**(섹션마다 폭 바꾸지 않는다). 글 전용 `.shell`만 720px
- 카드 hover: `scale(1.012)` 150ms + 보더가 액센트 쪽으로. `prefers-reduced-motion`에서 해제
- 설치 커맨드 블록: 복사 버튼 내장, 한 줄, mono

## 시그니처
1. **나선 타임라인** — 히어로 배경에 브랜드 마크(열린 1.5턴 나선)를 확대한 얇은 스트로크 1개. 기억이 쌓이는 시간축 은유. 반복 사용 금지
2. **제품 창(app mock)** — 히어로 바로 아래 풀블리드 밴드. **스크린샷이 아니라 손으로 짠 DOM**(`appMock()` in `src/template.mjs`): 밀도 무관 선명, 3개어 현지화, 이미지 바이트 0. `aria-hidden` + `data-nosnippet`. 창 크롬은 라이트 테마에서도 항상 다크(`--mock-*` 토큰) — 터미널 옆에 사는 도구를 라이트로 그리면 거짓말이다
3. **필름 그레인** — `.grain-surface::before`, feTurbulence 데이터 URI를 radial 마스크로 히어로에만. 라이트 multiply / 다크 screen. 평평한 색 띠 대신 쓰는 것이며, 그라데이션·글래스모피즘은 여전히 금지

장식은 이 셋뿐. 넷째를 추가하지 마라.

## 헤더
`position: sticky; top: 0`, 높이 `--header-height: 64px`, 기본 보더 투명 → `main.js`가 `scrollY > 8`에서 `.is-scrolled`를 토글해 하단 보더만 켠다(.25s). 배경은 `color-mix`로 반투명 + backdrop-filter.

## 빌드
`build.mjs`가 `style.css`/`main.js`의 sha256 앞 8자리를 계산해 `?v=…`로 붙인다. 캐시 무효화는 이 해시가 담당하니 파일명은 고정.

## 카피 규칙 (디자인과 한 몸)
- 신조(히어로 h1): "Your memory outlives every model." + 현지어 서브 (KO: 모델은 스쳐가도, 당신의 기억은 남는다)
- 서브라인: "Conflicts surfaced overnight. Resolved by you." 계열 (기능층)
- ⛔ 줄표(— – ㅡ) 금지, 과장·"유일" 클레임 금지, 실측 수치만(단 "오판 0/24" 등 소표본 수치 외부 금지)
- 신뢰 3문장은 검증 가능형으로: "내용은 네 기기를 떠나지 않는다 / 정본은 마크다운 파일이다 / 과거를 덮어쓰지 않는다"

## 상태/반응형
- 언어 전환: 우상단 텍스트 토글(KO/EN/JA), hreflang 정본. 자동감지+수동 우선
- 모바일: 히어로 신조 1열, 설치 블록 가로 스크롤 금지(줄바꿈), 터치 타깃 44px
- 빈 장식 금지: 스크린샷은 실물(대시보드 질문 탭·공유카드)만, 목업 일러스트 금지
