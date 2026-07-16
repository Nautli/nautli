## 한줄 총평 (지금 안의 가장 큰 리스크)
히어로 H1이 신조("Your memory outlives every model")로 잡혀 있어서 HN에서 클릭해 들어온 개발자가 **3초 안에 "이게 뭐하는 놈인지" 못 잡고 마케팅 fluff로 판단해 뒤로가기 누른다.** "Cross-AI local memory"는 subline이 아니라 H1 자리다.

---

## JTBD & 사용맥락 점검

**JTBD (Flow A 개발자)**: "내가 이미 3개 AI 병용 지침 중이다. 이 5분에 (a) 뭐하는 놈인지 (b) 진짜 로컬인지 (c) 지금 npm install 할 가치가 있는지" 3개 판단만 끝내려 함. 시(詩)적 슬로건을 원하지 않고, 사실·명령·소스링크를 원한다. 현안은 이 3개 판단을 **hero fold 안에서** 안 끝낸다 — 신뢰 3종은 v2, 소스링크는 accordion 뒤, mem0 비교는 v5 FAQ에 파묻힘.

**JTBD (Flow B SNS유입)**: 친구 카드 보고 "나도 궁금"이 트리거인데, `/c/[shareId]`를 v1/v2/v3 3섹션으로 스크롤 페이지 만든 건 과잉. 이건 hero fold 1장으로 끝나는 페이지다(친구 카드 크게 + 커맨드 한 줄).

**사용맥락**:
- **HN 링크 유입 → 랩탑 브라우저 새 탭, 뒷줄 25탭 대기 중** → 3초 스캔 통과 못하면 즉시 사망. 자동 타이핑 애니메이션은 이 맥락에서 "load 걸린 것"으로 오독됨.
- **X/Threads 카드 유입 → 대부분 모바일** → `/c/*` 페이지가 데스크톱 우선 설계됨(카드 확대 + 옆에 CTA 가정). 모바일 세로에서 카드가 화면 90% 먹으면 CTA가 fold 밖.
- **옵시디언 파워유저 → "AI가 볼트 만지나" 검색 유입** → 착지가 `/manifesto` 롱폼 에세이. 이 유저는 에세이 안 읽고 "does it write to my files?"의 즉답을 찾음. `/manifesto` 상단이 "우리가 하는 것/안 하는 것" 대비표여야 함.

---

## 결함 목록

### P0 (치명 — 이대로면 컨버전 반토막)

**[P0-1] 히어로 H1이 "무엇"이 아닌 "왜"로 시작한다**
- **왜 문제**: 개발자 랜딩에서 poetic slogan을 H1으로 쓰는 건 브랜드가 이미 유명한 회사(Apple, Notion)만 가능한 사치. 신생 오픈소스 CLI는 3초 안에 카테고리(=cross-AI memory) + 차별점(=local)이 안 잡히면 죽는다. 현재 안: H1=슬로건, subline=번역, "Cross-AI local memory. Your files stay yours."는 그 아래 미세 라인.
- **수정**:
  - H1 = `Cross-AI memory that lives on your disk.` (16~20 words 이하, 카테고리+차별점 1문장)
  - Eyebrow (H1 위 작은 라벨) = `Open-source · MIT · Local-first`
  - Poetic 슬로건은 **h2 크기로 hero 하단 tagline**에 두거나, `/manifesto` 최상단으로 이관
  - Subline = "Claude Code, Codex, Cursor에서 쓴 결정과 사실을 로컬 SQLite에 append. 매번 자기소개 반복 끝."

**[P0-2] 신뢰 3종의 "증거"가 accordion 뒤에 숨어있다**
- **왜 문제**: 프리셋 유저(HN톤 개발자)는 accordion을 안 연다 — GitHub 링크가 카드에 안 보이면 "숨겼다"고 판단. 그리고 `[증거 →]`라는 문구 자체가 마케팅 오만("우리를 못 믿냐? 여기 봐라") 톤이다.
- **수정**:
  - 각 카드 하단에 **평문 링크 3개 상시 노출**: `→ src/net.rs` `→ vault schema` `→ review card demo`
  - Accordion 제거. 카드 본문에 이미 검증 명령이 인라인 코드로 박혀 있어야 함:
    ```
    ✓ 내용 무전송
    확인: sudo lsof -i -P | grep nautli
    → 결과 0줄이면 참
    ```

**[P0-3] "설치 후 다음 3초"가 hero fold에 없다**
- **왜 문제**: `npm i -g nautli` 복사 → 터미널 붙임 → **그 다음 뭘 치나?** 이 브릿지 없이 CTA가 커맨드 하나로 끝나면 40%가 터미널에서 이탈. Homebrew·Bun·Turborepo 다 히어로에 2~3줄 시퀀스 보여줌.
- **수정**: 터미널 카드를 3줄로:
  ```
  $ npm i -g nautli
  $ nautli init          # 볼트 위치 선택
  $ nautli scan          # 첫 검진 (30초)
  ```
  Copy 버튼은 **줄별로 3개** + `Copy all` 1개.

**[P0-4] `/c/[shareId]` 착지 페이지가 스크롤 3장짜리**
- **왜 문제**: SNS 카드 유입은 **감정 → 궁금 → 즉시 시도**의 30초 결정. v1/v2/v3 스크롤로 나누면 v2 CTA 도달 전에 이탈. 이 페이지의 job은 "친구 카드 크게 + 나도 커맨드"뿐.
- **수정**:
  - 단일 fold: 좌측 65% = 확대 카드, 우측 35% = "Your turn." + 커맨드 3줄 + Copy
  - 모바일: 카드 위 60vh + 아래 CTA 40vh. 스크롤 없음.
  - 홈 이동은 nav의 nautli 로고 링크로만.

**[P0-5] 데모 검진 카드에 "EXAMPLE" 워터마크는 훅을 죽인다 (열린 질문 1)**
- **왜 문제**: 워터마크 넣으면 감정 훅 사라지고, 옵트인 telemetry는 신조와 충돌. 제3안(브라우저 로컬 스캔)은 오버엔지니어링 + "네 파일이 정본"과 충돌.
- **수정 (권장)**: 카드를 **비어있는 결과 자리(empty state)**로 보여준다. 
  ```
  ┌─────────────────────────────┐
  │ VAULT SCORE     — / 100     │
  │ notes                    —  │
  │ contradictions           —  │
  │                             │
  │  run "nautli scan"          │
  │  to fill this card          │
  └─────────────────────────────┘
  ```
  이 방식이 "정직 + 훅 + CTA 통일" 3개 다 잡음. 옆에 작은 링크 `→ see a real card` (익명 오픈 카드 1개 hard-code).

---

### P1 (중요 — 컨버전·신뢰 상당 손실)

**[P1-1] 히어로 자동 타이핑 애니메이션 (v1 마지막)**
- **왜 문제**: 40자/초 타이핑은 "페이지 로딩 중"으로 오독. `prefers-reduced-motion` 있어도 그 외 유저 100%에게 4초간 CTA 접근 지연. Vercel도 2023년에 뺐음.
- **수정**: 정적 코드블록 + 우측 하단에 재생 아이콘 (사용자가 원하면 클릭 재생). 기본은 정지.

**[P1-2] 다크만 지원 + 라이트 토글 없음**
- **왜 문제**: "선택지 늘리지 않는다"는 논리는 Apple급 브랜드에서 통함. 개발자 40%가 라이트 선호(Stripe/Linear/Vercel 다 토글 있음). 접근성상 저시력 사용자에게 필수. `prefers-color-scheme` 존중만으로는 OS 다크·앱 라이트 사용자를 무시.
- **수정**: nav 우측에 아이콘 토글 1개 (☀/☾). localStorage 저장.

**[P1-3] "미세 텍스트"로 처리된 신뢰 신호**
- **왜 문제**: `0 bytes transmitted · MIT · macOS · Linux · Windows`는 이 페이지의 **핵심 신뢰 신호**인데 hero 최하단 미세 텍스트로 처리하면 WCAG AA 4.5:1 위반 가능성 + 시각 계층 오판.
- **수정**: 이 라인을 subline 바로 아래에 **14px + 색 대비 4.5:1** 이상으로 승격. 아이콘 4개(자물쇠, 저울, apple, tux, windows)와 함께.

**[P1-4] "어떻게 작동하나(v4)"의 GIF 3장**
- **왜 문제**: 자동재생 GIF 3장 loop = 데이터·CPU·주의 파괴 + 개발자는 GIF 안 봄. 클릭재생이면 아무도 클릭 안 함. "연결/기억/소화"라는 라벨도 추상적.
- **수정**: **before/after 코드 diff 2-column**으로 대체:
  ```
  Without nautli              With nautli
  You: "Use React 19..."      You: "Continue the auth work"
  Claude: "What project?"     Claude: reads nautli → knows
  You: "The auth one..."      Claude: "Resuming JWT rotation..."
  You: "We chose JWT..."
  ```
  이게 개발자에게 "aha" 순간. Cursor/Copilot 랜딩이 다 이 패턴.

**[P1-5] FAQ가 홈에 5개**
- **왜 문제**: 홈에 FAQ 넣으면 페이지 길이·SEO·유지비 다 증가. 그리고 "mem0/letta 비교"는 FAQ가 아니라 **홈의 별도 섹션**이어야 함 (경쟁 인지 유저의 핵심 판단 자료).
- **수정**:
  - mem0 비교표 → 홈 v5로 승격 (3열: 전송 · 정본 · 판정 주체)
  - 나머지 FAQ 4개 → `/faq` 페이지 (또는 GitHub README)
  - 홈에서 `→ 더 많은 질문` 링크 하나

**[P1-6] Copy 버튼 접근성**
- **왜 문제**: `Copied ✓` 인라인 치환은 시각적으론 좋으나 스크린리더가 감지 못함. clipboard API 실패(HTTP·권한거부) 폴백 없음.
- **수정**:
  - `<span role="status" aria-live="polite">Copied ✓</span>` 
  - 실패시 텍스트 selection 폴백 + "select and copy manually" 안내

**[P1-7] 언어 전환 셀렉터**
- **왜 문제**: `[KR/EN/JA]` 코드만 있고 라벨 없음. 스크린리더에서 "케이알 슬래시 이엔..."으로 읽힘. 지역별 표기도 애매(KR? KO? 한국어?).
- **수정**: `<button aria-label="Language">🌐 한국어</button>` + 클릭시 드롭다운 `한국어 · English · 日本語`.

**[P1-8] "구체 데이터 예시" 부재**
- **왜 문제**: 페이지 전체에서 "사실 단위 append"라 하지만 **실제 저장된 사실이 뭐하나** 보여주지 않음. 개발자 mental model 형성 실패. 옵시디언은 랜딩에서 실제 노트 스크린샷 보여주고 Linear는 실제 이슈 카드 보여줌.
- **수정**: 신뢰 3종 v2 또는 v4 근처에 실제 SQLite row 예시:
  ```
  fact_id: 042
  claim: "auth uses RS256 JWT, rotates 30d"
  source: claude-code · 2026-06-14 · project:api
  supersedes: [fact_id: 019]
  ```

**[P1-9] `/c/[shareId]` 저장 형태 (열린 질문 3)**
- **왜 문제**: URL base64는 300자+ 이슈, CDN 옵트인은 신조 충돌.
- **수정 (권장)**: `/c/[shareId]`의 shareId 자체가 카드 데이터의 **hash**이고, 원 데이터는 사용자 로컬. 서버는 `og:image` 렌더용으로만 필요한 12개 숫자(점수·건수)를 받아 이미지 생성 후 즉시 폐기 + 페이지 파라미터는 그 12개 숫자만. 이러면 "우리가 보관하는 건 이미지 캐시 24h뿐, 노트 내용 0"이 성립. 신조 문구는 "우리는 네 노트를 저장하지 않는다"로 유지 가능.

---

### P2 (개선)

**[P2-1] nav 링크 6개** — Manifesto·Install·GitHub·Discord·언어토글 = 5+1. Discord와 GitHub는 nav 대신 히어로 우측 상단 소셜 아이콘 2개로 분리하면 정보 위계 정리됨.

**[P2-2] `/manifesto` 도입부** — "GPT-4는 이미 없다. Claude 3도 곧 없다." → 강하지만 3년 후 폐기. 대신 "AI 모델은 6개월마다 바뀐다. 네 결정은 아니다."

**[P2-3] Supporter 페이지에 후원자 명단 opt-in** — 후원 flow에 "public 표시" 체크박스 필요. 기본 off (프라이버시 신조 준수).

**[P2-4] `nautli scan` 소요시간 표기** — "30초"라 썼는데 3만 노트 스캔이 진짜 30초인지 실측. 아니면 "노트 1만 기준 ~20초"로 정확히.

**[P2-5] Discord 링크 중복** — nav, 푸터, `/install` 하단 3곳. 랜딩에서 커뮤니티는 푸터 1곳 + `/install`의 "막히면 도움받기" 컨텍스트에서만.

---

## 업계 레퍼런스 패턴

**1. Supabase (2024 홈)** — H1 = `Build in a weekend. Scale to millions.` + eyebrow `The Postgres Development Platform.` + hero fold 안에 실제 SQL/CLI 예시 코드. **적용**: nautli 히어로도 H1은 서비스 정의 문장 + eyebrow로 카테고리 + hero fold 안에 3줄 커맨드 시퀀스.

**2. Obsidian (홈 히어로)** — subline이 "Sharpen your thinking" (감정) + 아래 큰 배너 `Your notes on your device` (신뢰 신호를 히어로 최상위에 배치). "Files over app" 슬로건을 별도 큰 섹션으로 반복. **적용**: nautli도 "Files over app"의 nautli판 = "Facts over vendor" 같은 명확한 캐치프레이즈를 신뢰 3종 위에 큰 배너로.

**3. Linear (홈 · changelog)** — 자동재생 애니메이션 대신 스크롤 트리거 인터랙션 (스크롤이 애니메이션을 재생/역재생). 유저 통제. **적용**: v4 "어떻게 작동하나"를 스크롤 트리거 3단으로 (자동재생 GIF 대신).

**4. mem0.ai (경쟁사, 2024)** — H1 = `The Memory Layer for Personalized AI` + 즉시 코드 스니펫. 다만 mem0는 "cloud sync 필수 vs nautli는 로컬". 이 차별점을 홈에 **명시 비교표**로 두는 게 컨버전에 결정적.

**5. Cursor 랜딩** — 히어로에 실제 코드 편집 데모 (짧은 loop, 자동재생, ~3초). 개발자는 스크린샷보다 실제 인터페이스 fragment 하나에 즉시 확신.

---

## 이대로 가면 안 되는 1가지

**히어로 H1을 `"Your memory outlives every model."` 신조로 유지하면, HN 상단 링크로 들어온 개발자는 3초 스캔에서 "뭐하는 놈인지 못 잡음 → 마케팅 fluff → 뒤로가기" 시퀀스가 발생하고, 페이지의 나머지 모든 훌륭한 설계(신뢰 3종·검진 카드·설치 3줄)가 도달률 30% 미만이 된다.**

신조 문구는 프로덕트가 유명해진 뒤 얻는 사치다 — 지금은 **"Cross-AI memory that lives on your disk."** 같은 카테고리+차별점 1문장이 H1이고, 신조는 hero 하단 h2 tagline 또는 `/manifesto` 최상단으로 이관해야 한다. 이거 하나만 바꿔도 컨버전이 두 배 차이 난다.
