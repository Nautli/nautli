# nautli.ai 랜딩 DESIGN 토큰 v2 (웹사이트 비주얼 SSOT — 토큰 외 색/폰트 발명 금지)

> v2(2026-07-19): obsidian.md 코드 해부 결과를 이식. 해부 근거·미채택 항목은 `OBSIDIAN-TEARDOWN.md`.

> 대상: 공개 마케팅/온보딩 웹사이트(nautli.ai). 로컬 대시보드(docs/DESIGN-dashboard.md, 다크 Orca)와 별개 표면 — 단 브랜드 킷은 공유.
> 브랜드 정본 = `assets/brand/` (원본: ~/Desktop/brand-logos/FINAL/nautli/). ⛔ warm clay-orange/cream 절대 금지.

## 콘셉트
"기록은 오래 산다" — 앵무조개(수억 년 살아남은 나선)의 정적이고 단단한 느낌. 개발자 대상이므로 과장 없는 문서 같은 랜딩. 화려한 그라데이션·글래스모피즘 금지.

## 컬러 (라이트 우선 + 다크 대응)
라이트(기본):
- --bg: #F7F7F5 (Off-white — 순백 금지)
- --bg-card: #FFFFFF
- --text: #141414 (Ink)
- --text-dim: #5c5c58
- --accent: #087A6B (Teal — 링크·주 CTA·마크. **틸 액센트 하나만**, 보조 액센트 금지)
- --accent-soft: #087A6B14 (배경 틴트)
- --border: #e3e3df
다크(prefers-color-scheme):
- --bg: #141414 / --bg-card: #1c1c1a / --text: #F7F7F5 / --text-dim: #a3a39e
- --accent: #12A88F (다크에선 bright teal) / --border: #2a2a27

## 타이포 (3개어)
- 본문 스택: Inter, Pretendard, "Noto Sans JP", -apple-system, sans-serif
- **Inter는 실제로 셀프호스트한다**(`src/fonts/Inter-{400,500,600,700}.woff2`, 라틴 서브셋 `unicode-range: U+0000-00FF …`). KO/JA 글리프는 싣지 말고 시스템 스택으로 흘린다 — CJK를 번들하면 수 MB. 외부 CDN 금지
- 코드/설치 커맨드: ui-monospace, "SF Mono", monospace — **단 한/일 문장은 mono 금지**(한글 글리프 폴백 붕 뜸, 대시보드 검안 2회 적발 교훈)
- 크기: h1 clamp(38px, 11vw, 60px) 700 / h2 clamp(30px, 4.4vw, 44px) 600 / 본문 16px / 섹션 라벨 14px 대문자 letter-spacing .08em --text-dim
- **서브헤드는 크게**: 히어로 서브라인 clamp(19px, 2.2vw, 26px), 섹션 인트로 clamp(18px, 2vw, 23px), 둘 다 --text-dim. 제목/서브헤드 2단으로 위계를 끝낸다
- `text-wrap: pretty`를 루트에, `balance`를 h1/h2에. 히어로 h1은 모바일에서 뷰포트 비례(11vw)로 커진다
- 신조는 영어 원문이 주, 현지어 번역이 서브 (3개어 공통 규칙)

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
