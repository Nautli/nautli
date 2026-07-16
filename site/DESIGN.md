# nautli.ai 랜딩 DESIGN 토큰 v1 (웹사이트 비주얼 SSOT — 토큰 외 색/폰트 발명 금지)

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
- 본문 스택: Inter, Pretendard, "Noto Sans JP", -apple-system, sans-serif — 셀프호스트 서브셋(외부 CDN 금지, 서버렌더 한글폰트 교훈: OFL 번들)
- 코드/설치 커맨드: ui-monospace, "SF Mono", monospace — **단 한/일 문장은 mono 금지**(한글 글리프 폴백 붕 뜸, 대시보드 검안 2회 적발 교훈)
- 크기: 히어로 신조 clamp(32px, 5vw, 56px) 700 / 서브라인 18px 400 --text-dim / 본문 16px / 섹션 제목 14px 대문자 letter-spacing .08em --text-dim
- 신조는 영어 원문이 주, 현지어 번역이 서브 (3개어 공통 규칙)

## 형태
- radius: 카드 12px, 버튼 8px, 코드블록 8px (제품 대시보드와 통일)
- 카드: --bg-card + 1px --border, 그림자 없음(플랫)
- 주 CTA 버튼: --accent 배경 + #F7F7F5 글자. 보조: 투명 + 1px --border
- 간격 4px 배수, 콘텐츠 최대폭 720px(글) / 960px(히어로·데모) 중앙
- 설치 커맨드 블록: 복사 버튼 내장, 한 줄, mono

## 시그니처 1개: 나선 타임라인
히어로 배경 또는 섹션 구분에 브랜드 마크(열린 1.5턴 나선)를 확대한 얇은 스트로크 라인 1개 — 기억이 쌓이는 시간축 은유. 장식은 이것 하나만, 반복 사용 금지.

## 카피 규칙 (디자인과 한 몸)
- 신조(히어로 h1): "Your memory outlives every model." + 현지어 서브 (KO: 모델은 스쳐가도, 당신의 기억은 남는다)
- 서브라인: "Conflicts surfaced overnight. Resolved by you." 계열 (기능층)
- ⛔ 줄표(— – ㅡ) 금지, 과장·"유일" 클레임 금지, 실측 수치만(단 "오판 0/24" 등 소표본 수치 외부 금지)
- 신뢰 3문장은 검증 가능형으로: "내용은 네 기기를 떠나지 않는다 / 정본은 마크다운 파일이다 / 과거를 덮어쓰지 않는다"

## 상태/반응형
- 언어 전환: 우상단 텍스트 토글(KO/EN/JA), hreflang 정본. 자동감지+수동 우선
- 모바일: 히어로 신조 1열, 설치 블록 가로 스크롤 금지(줄바꿈), 터치 타깃 44px
- 빈 장식 금지: 스크린샷은 실물(대시보드 질문 탭·공유카드)만, 목업 일러스트 금지
