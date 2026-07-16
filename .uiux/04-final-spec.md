# nautli.ai 랜딩 최종 UI/UX 스펙 (디렉터 합성, 2026-07-16)

> 합성 주체: 디렉터(메인 세션 인라인 — 하이브리드 규칙 §1). 입력: 01-proposal + 02-expert-critique(opus) + 03-user-feedback(codex 페르소나, gemini CLI 사망 대체). 비주얼 정본 = `site/DESIGN.md` (토큰 외 발명 금지).

## 토론 반영 요약 (수용/기각 + 이유)

**수용 (전문가+유저 수렴 지점 전부):**
1. **[P0-1] H1 = 카테고리+차별점 문장, 신조는 재배치** — 양측 일치("3초 안에 뭐하는 놈인지" / "세계관 먼저 설득하려 하면 뒤로 간다"). H1 = "Cross-AI memory that lives on your disk." 신조 "Your memory outlives every model."는 **지위 유지·위치 이동**: 히어로 폴드 하단 전폭 배너(h2) + /manifesto 최상단. ⚠️유저(회장) 확정사항 "신조=한 문장 미션"과 충돌 아님 — 신조는 브랜드 정본으로 유지, 랜딩 H1 자리만 카테고리 문장에 양보. 회장 재가 필요 시 이 항목만 뒤집으면 됨.
2. **[P0-2] 증거는 숨기지 않는다** — accordion 제거, 카드 본문에 검증 명령 인라인 + 평문 링크 상시 노출.
3. **[P0-3] 설치 3줄 시퀀스** — `npm i -g nautli` / `nautli init` / `nautli checkup ~/notes`(줄별 Copy + Copy all). 유저 우려 반영: 그 아래 작은 라인 "먼저 빈 폴더로 시험: `nautli checkup ./empty-test`".
4. **[P0-4] /c/[shareId] 단일 폴드** — 좌 65% 카드 / 우 35% "Your turn"+3줄 커맨드. 모바일 60vh/40vh 무스크롤.
5. **[P0-5+유저] 검진 카드 = empty state** ("run nautli checkup to fill this card") + **실물 리뷰카드 3종 예시**(①진짜 모순 ②시간이 지나 바뀐 결정 = "오류가 아니라 기록입니다"(supersedes, non-lossy 정체성) ③단순 중복). 점수엔 `→ 산식 보기` 링크(TASK-018 산식 공개와 연동).
6. **[유저] "Reads / Writes / Sends" 표 신설** — 신뢰 섹션 최상단. 3열: 읽는 것(선택한 폴더만, 제외 지정 가능) / 쓰는 것(~/.nautli, 클라이언트 지시문 블록 — 목록+제거법 링크) / 보내는 것(노트 내용: 없음 · 판정: 본인 Claude 구독 경유 Anthropic · 선택 수집: 기본 꺼짐). **"0 bytes" 류 단정 금지, 범위 정확히**: "Your notes never reach our servers."
7. **[P1-4] How it works = before/after 대화 diff 2열** (GIF·타이핑 애니메이션 전부 제거 — 양측 일치. 유저: "움직이는 로그보다 생성되는 파일 한 장").
8. **[P1-8] 실제 fact row 예시 1개** (claim/source/supersedes 필드 보이게).
9. **[P1-5] mem0류 비교표 홈 승격** — 3열: 전송 · 정본 · 판정 주체. FAQ는 /faq로.
10. **[P1-2] 라이트/다크 토글** (DESIGN.md 라이트 우선과 정합, localStorage).
11. **[P1-6/7] 접근성** — Copy `role="status" aria-live`+실패 폴백, 언어는 `🌐 한국어` 드롭다운(한국어·English·日本語), 대비 4.5:1.
12. **[P1-9] 공유 데이터 범위** — shareId=해시, 서버가 받는 건 숫자 12개(og 렌더 후 즉시 폐기) — 단 **v1 정적 빌드에선 서버 없음**: /c/ 페이지는 쿼리 파라미터(숫자만)로 클라이언트 렌더, og는 기본 브랜드 이미지. 동적 og는 v2 백로그.
13. **[P2 전부]** nav 정리(GitHub·Discord는 아이콘), manifesto 도입 문구 교체("AI 모델은 6개월마다 바뀐다. 네 결정은 아니다."), Supporter 명단 opt-in 기본 off, 소요시간 실측 표기만, Discord 링크는 푸터+install 막힘 컨텍스트 2곳만.

**기각:**
- 유저 "공유카드(점수) 빼라" — 기각. K루프 전략 자산(마케팅플랜 v2). 대신 산식 링크+실례 중심으로 완화(수용 5). 근거: 시뮬 부정신호는 조정 재료지만 이 카드는 실측 전략 결정.
- 전문가 "스크롤 트리거 인터랙션(Linear식)" — 기각. v1 정적 사이트 복잡도 대비 가치 낮음, reduced-motion 원칙 우선.

## 최종 스펙 (codex 구현용)

### 기술 구조
- **순수 정적**: `site/` 아래 빌드 스크립트(`site/build.mjs`, Node stdlib만) + `site/src/`(템플릿·콘텐츠) → `site/dist/` 출력. 프레임워크·외부 의존성 0.
- **i18n**: `site/src/i18n/{en,ko,ja}.json`. 경로 = `/`(EN 기본), `/ko/`, `/ja/`. 모든 페이지 `<link rel="alternate" hreflang>` 3종+x-default. `<html lang>` 정확히.
- 페이지 5: `index.html`, `manifesto.html`, `install.html`, `faq.html`, `c/index.html`(쿼리 파라미터 렌더). 로케일별 생성 = 15장.
- SEO: 페이지별 title/description(로케일별), OG 태그(og 이미지=assets/brand og 1200x630), JSON-LD(SoftwareApplication), sitemap.xml, robots.txt.
- CSS: 단일 `style.css`, DESIGN.md 토큰을 :root CSS 변수로. JS: `main.js` 하나(복사 버튼·테마 토글·언어 드롭다운·/c/ 파라미터 렌더). 외부 요청 0(폰트는 v1 시스템 스택 허용: Inter 미번들 시 -apple-system 우선).

### 홈 index (폴드 순서)
1. **nav**: 좌 `nautli`(워드마크, 소문자) / 우: Manifesto · Install · [GitHub 아이콘] [Discord 아이콘] · 🌐언어 · ☀/☾
2. **Hero (개정 2026-07-16 유저 지시 — 서브라인=독점 엣지)**: eyebrow `Open source · MIT · Local-first` / H1 "Cross-AI memory that lives on your disk." (KO "AI들이 함께 쓰는 기억, 네 디스크에 산다" / JA "AIをまたぐ記憶を、あなたのディスクに") — 카테고리+소유, 3초 인지용 / **subline(엣지, 최종 확정 2026-07-16 3차 — 경쟁 6사 실카피 비교 후)**: **"Conflicts surfaced overnight. Settled by you."** (KO "밤새 찾아낸 모순, 판정은 당신이 합니다." / JA "夜のうちに見つかった矛盾。決めるのはあなた。") — 근거: 경쟁 전원(Mem0·Supermemory·MemoryLake·Letta·Zep·gbrain)의 카피가 [AI가 주어 × 인프라 은유 × 더 많이 기억]에 몰려 있어, [사람이 주어 × 기억의 진실성 × conflict 구체어]가 백지 공간(정본=마케팅플랜 v2 카피 경쟁비교). "AI asks. You decide."는 보편 AI 문구라 기각(유저), "AI asks" 계열 일반화 금지. 긴 설명은 How-it-works 도입문으로 / "Claude Code, Codex, Cursor가 같은 기억을 읽는다" 라인은 3번째 소형 라인 또는 How-it-works로 강등 / 터미널 카드 3줄+Copy / 신뢰 라인(14px, 대비 준수): 🔒 Your notes never reach our servers · **No silent rewrites** · MIT · macOS(타 OS는 실지원 확인 전 표기 금지)
3. **신조 배너(전폭, --accent-soft 배경)**: "Your memory outlives every model." + 로케일 서브 + `→ Manifesto`
4. **Reads/Writes/Sends 표** (수용 6)
5. **신뢰 3카드** (검증 명령 인라인 + 평문 링크) + 실제 fact row 예시
6. **How it works**: before/after 대화 diff 2열
7. **검진 훅**: H2 "네 볼트, 몇 점?" + empty-state 카드 + 실물 리뷰카드 3종 + `→ 산식 보기`(문서 링크)
8. **비교표**: Cloud memory layer vs nautli — 전송/정본/판정 주체 3열. 특정사 비방 금지, 사실 항목만.
9. **Supporter + Discord**(각 1블록, 절제) / 푸터: GitHub·Discord·license·언어

### 서브 페이지
- **/manifesto**: 최상단 신조 + "우리가 하는 것/안 하는 것" 대비표 → 짧은 에세이("AI 모델은 6개월마다 바뀐다. 네 결정은 아니다."로 시작)
- **/install**: 요구사항표 → 3줄 설치 → **바뀌는 파일 목록+원복 방법** → 빈 폴더 테스트 → 막히면: GitHub Issues·Discord
- **/faq**: 5문항(전송 범위 / judge가 뭘 보내나 / 옵시디언 볼트 안전 / 제거법 / 가격·Supporter)
- **/c/**: 단일 폴드 공유 착지(수용 4·12)

### 카피 전 규칙
줄표 금지 · "유일/최초" 금지 · 미실측 수치 금지(30초·3만노트 등 검증 전 표기 금지, 실측치만) · 이모지는 신뢰 라인 🔒·언어 🌐 2곳만 · 각 로케일은 번역투 금지(각 언어 네이티브 카피)

## 구현 체크리스트 (codex가 지킬 것)
- [ ] site/DESIGN.md 토큰만 사용(색·radius·타이포 발명 금지), 라이트 기본+다크
- [ ] 외부 네트워크 요청 0 (CDN·폰트·analytics 없음 — 그 자체가 신뢰 증명)
- [ ] 한/일 텍스트에 mono 폰트 금지
- [ ] 모든 인터랙티브 요소 키보드 접근+aria
- [ ] 빌드: `node site/build.mjs` 1커맨드 → dist/ 완성, 로케일 15페이지+sitemap+robots
- [ ] 모바일 375px에서 히어로·/c/ 무가로스크롤
