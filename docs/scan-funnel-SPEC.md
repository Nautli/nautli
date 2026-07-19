# nautli scan 퍼널 SPEC (v1) — 2026-07-19

목표: 진단 페이지에서 "프롬프트 복사" → 유저의 AI(Claude Code 등)가 `npx nautli@latest scan` 실행 → 로컬 크로스AI 기억 진단 → 브랜딩 HTML 리포트 자동 오픈 → 익명 숫자 핑(백분위) → PnL식 공유 카드(`nautli.ai/r/:id`) → 갤러리 전시.

핵심 신뢰 불변식(전 레이어): **파일 경로·파일명·내용은 절대 기기를 떠나지 않는다. 네트워크로 나가는 것은 아래 허용된 숫자 필드 + 닉네임뿐.** 이 정책은 "안 보내게 돼 있다"가 아니라 클라이언트 직렬화기와 서버 allowlist 검증 양쪽에서 "못 보내게 막는다"(위반 시 400).

---

## 1. 데이터 스키마 (SSOT — 전 스텝 공유)

```js
// ScanResult (CLI 내부 + --json 출력)
{
  v: 1,
  os: "mac" | "win" | "linux",
  tools: [ { id: ToolId, files: int, tokens: int } ],   // 감지된 도구만
  totals: { files: int, tokens: int, alTokens: int },   // alTokens = 상시로드 파일 토큰 합
  findings: [ { group: "alwaysLoaded"|"crossTool"|"repeated"|"large"|"debris"|"stale",
                weight: 0|1|2|3, title: str, measure: str, why: str, files: [str] } ],
  score: int(20..100), grade: "S"|"A"|"B"|"C"|"F",
  estMonthlyUsd: number,          // 소수 1자리
  partial: bool
}
// ToolId enum: "claude-code"|"codex"|"cursor"|"copilot"|"gemini"|"windsurf"|"cline"|"obsidian"|"project"

// PingPayload → POST https://nautli.ai/api/ping  (숫자만!)
{ v:1, score:int, tools:int, tokens:int, alTokens:int, findings:int, os:str }

// PingResponse
{ ok:true, count:int, percentile:int }   // percentile = 내 점수 미만 비율 0..99

// SharePayload → POST /api/share  (숫자 + nick만!)
{ v:1, score:int, tools:int, tokens:int, alTokens:int, findings:int, os:str, nick?:str }

// ShareResponse
{ ok:true, id:str, url:"https://nautli.ai/r/<id>" }

// Card (서버 저장, GET /api/card?id= 응답의 card 필드)
{ id, score, grade, percentile, tools, tokens, alTokens, findings, estMonthlyUsd, nick, os, ts }
// grade·estMonthlyUsd·percentile은 서버가 재계산 — 클라 값 신뢰 금지
```

파생 공식(클라·서버 동일 구현, 각각 단위테스트):
- grade: S≥90, A≥78, B≥65, C≥50, F<50
- estMonthlyUsd = round(alTokens/1e6 * 3 * 10 * 30 * 10)/10  (입력단가 $3/1M tok × 10세션/일 × 30일, 리포트에 "추정·가정" 각주 필수)
- score = max(20, 100 - min(80, Σ(weight×4)))  (weight 0 제외)
- 토큰 추정 estimateTokens: CJK 글자수 + 비CJK길이/4 (site/src/diagnose.js:51 동일 로직)

## 2. CLI `nautli scan` (신규, 기존 checkup과 완전 별개·무설정 일회 실행)

파일: `src/scan/discover.js`, `src/scan/analyze.js`, `src/scan/report.js`, `src/scan/ping.js`, `src/scan/index.js`, `src/cli.js`(커맨드 연결+help)

플래그: `--json`(ScanResult stdout, 리포트·핑 생략 아님 — 핑은 동일), `--no-open`, `--no-ping`, `--lang en|ko`(기본: 기존 CLI locale 감지 재사용)

### 2a. discover — 크로스플랫폼 경로 자동 발견 (읽기 전용)
home=os.homedir(), 존재하는 것만. macOS·Windows·linux 3분기 전부 구현:
- claude-code: `~/.claude/CLAUDE.md`, `~/.claude/projects/*/memory/**/*.md`
- codex: `~/.codex/AGENTS.md`, `~/AGENTS.md`
- gemini: `~/.gemini/GEMINI.md`
- cursor: `~/.cursor/rules/**/*.{md,mdc}`
- windsurf: `~/.windsurfrules`, `~/.windsurf/rules/**`
- cline: `~/.clinerules`
- obsidian 볼트 목록: mac `~/Library/Application Support/obsidian/obsidian.json`, win `%APPDATA%/obsidian/obsidian.json`, linux `~/.config/obsidian/obsidian.json` → `vaults{}.path` 각 볼트의 `**/*.{md,markdown,txt}`
- project(cwd): `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.cursor/rules/**`, `GEMINI.md`, `.github/copilot-instructions.md`(→copilot), `.windsurfrules`, `.clinerules`
- 제외 디렉토리: node_modules, .git, .obsidian, .trash (대소문자 무시). 심볼릭 링크 순환 방지(방문 realpath Set).
- 캡: 총 4000파일 / 40MB, 파일당 2MB 초과 스킵. 캡 도달 시 partial=true.
- ChatGPT 서버 메모리 등 로컬에 없는 것은 **언급 자체를 안 함**(스캔 불가 표기도 금지 — 유저 확정).

### 2b. analyze — site/src/diagnose.js의 신호 로직 포팅 + 크로스툴 신호 추가
- alwaysLoaded(상시 로드): 이름 매칭 `CLAUDE.md|AGENTS.md|GEMINI.md|.cursorrules|.windsurfrules|.clinerules|copilot-instructions.md|MEMORY.md`(경로 무관) → 1500tok 미만 무시, >6000 weight3, 아니면 weight2
- **crossTool(신규, 최고가치)**: 정규화 문단(diagnose.js normalizeBlock, 80자↑)이 **서로 다른 ToolId** 문서에 동시 존재 → weight3. title 예: "같은 규칙이 claude-code와 cursor에 따로 산다". 리포트 최상단 배치.
- repeated: 같은 문단이 같은 도구 내 2+파일 → 4파일↑ w3, 아니면 w2 (상위 12개)
- large: 상위 3개, 60KB↑ w1 / debris: 빈파일(20자↓)·TODO|FIXME|XXX|WIP 5개↑ w1 / stale: 1년↑ w0(점수 제외)
- 도구별 집계 tools[] 채움.

### 2c. report — 자기완결 HTML 1파일 생성 + 자동 오픈
- 경로: `os.tmpdir()/nautli-scan-<yyyymmdd-hhmmss>.html` (설치 흔적 0)
- 오픈: mac `open`, win `cmd /c start "" <file>`, linux `xdg-open` (spawn, 실패해도 경로만 출력하고 정상 종료)
- 디자인: 사이트 토큰 재사용 — `site/DESIGN.md`와 `site/src/style.css`의 색·타이포 변수를 읽어 동일 다크 룩(배경 #141414 계열, 민트 액센트). 인라인 CSS, 외부 요청 0(폰트는 system-ui 스택).
- 구성(위→아래): ①큰 점수+등급 배지+백분위("상위 N%", 핑 성공 시만) ②estMonthlyUsd 헤드라인 "매달 약 $X를 낡은 기억 재로드에 지불 중"+가정 각주 ③도구별 브레이크다운 표(도구·파일수·토큰) ④findings 카드(크로스툴 우선, 근거 파일목록 접힘 details) ⑤공유 섹션: PnL식 카드 미리보기(HTML/CSS 렌더) + 버튼 2개: [카드 PNG 저장](canvas, 업로드 없음) [공유 링크 만들기](POST /api/share→URL 복사표시) + 닉네임 입력(선택, 20자) ⑥푸터: "전송된 것: 숫자 7개뿐(score,tools,tokens,alTokens,findings,os,v). 파일명·내용은 기기를 떠나지 않음" + nautli 설치 CTA(`https://nautli.ai/install`)
- 카드 디자인(리포트 내 미리보기·PNG·/r 페이지 3곳 동일): 1200×630 비율 다크 카드, 좌상 nautli 워드마크, 중앙 초대형 점수+등급, 서브스탯 1줄 "AI {tools}개 · 기억 {tokens}tok · 신호 {findings}건", 우하단 nautli.ai. 등급별 액센트: S=민트, A=청록, B=노랑, C=주황, F=빨강.
- i18n: en/ko 최소 2개. 리포트 내 문구는 report.js 내 사전 객체(별도 파일 불필요).
- ⛔ onClick 없는 죽은 버튼 금지. fetch 실패 시 버튼에 에러 문구 표시(무음 금지).

### 2d. ping — 익명 숫자 핑
- `POST https://nautli.ai/api/ping` PingPayload, timeout 2s, 실패 무음(스캔은 오프라인에서도 완주). `--no-ping` 시 생략.
- **직렬화 가드**: payload는 `buildPingPayload(result)` 함수만 생성 가능, 허용 키 하드코딩, 문자열 필드는 os enum뿐. 이 함수에 단위테스트(경로 포함 객체를 넣어도 숫자 외 필드가 절대 안 나감).
- 성공 시 percentile을 리포트에 주입(리포트 생성 전에 핑 먼저).

### 2e. 터미널 출력(사람용 3~5줄): 점수/등급, 도구 수, 상위 발견 1줄, 리포트 경로, "전송=숫자 7개, --no-ping로 끔". `--json`이면 ScanResult만 stdout(기존 writeJson 관례).
- 스캔 파일은 절대 수정·삭제 안 함(읽기 전용). 실패한 파일 read는 스킵.
- src/cli.js의 기존 관례(parseCommand, codedError, t()) 준수. CLI 도움말에 scan 추가.

## 3. 백엔드 — Vercel Functions (`site/api/` → build가 `dist/api/` 복사)

파일: `site/api/_kv.js`(공유), `ping.js`, `share.js`, `card.js`, `gallery.js`, `r.js` + `site/build.mjs` 수정(api 복사 + vercel.json에 rewrite `{source:"/r/:id", destination:"/api/r?id=:id"}` 추가)

- 런타임: Vercel Node functions, **의존성 0**(package.json 없이 동작 — Upstash REST를 fetch로 직접). ESM `export default async (req,res)`.
- KV: env `KV_REST_API_URL`/`KV_REST_API_TOKEN` (기존 공유 Upstash 인스턴스). **모든 키 `nt:` 프리픽스 — _kv.js에 assertNtKey 가드(cc:/spv: 오염 원천 차단), 단위테스트.**
- CORS: ping/share/card/gallery에 `Access-Control-Allow-Origin: *`(리포트가 file:// 에서 fetch), OPTIONS 204.
- 입력 검증(서버가 정본): 허용 키 외 존재→400. score int 20..100, tools 0..20, tokens 0..10_000_000, alTokens 0..tokens, findings 0..500, os∈{mac,win,linux}, nick은 유니코드 letter/number/공백/._- 만 남기고 20자 절단. grade·estMonthlyUsd·percentile은 서버 재계산.
- 레이트리밋: IP당(`x-forwarded-for` 첫 값) `nt:rl:ping:{ip}` 60/h, `nt:rl:share:{ip}` 10/h — INCR+EXPIRE, 초과 429.

키 설계:
- `nt:hist` HASH field=score(20..100) HINCRBY 1  → percentile = floor(100×(내점수 미만 합)/총합), 총합 0이면 percentile 생략(ok:true, count:0)
- `nt:stats:count` INCR, `nt:stats:sum` INCRBY score, `nt:stats:week:{ISO주}` INCR EXPIRE 14d
- `nt:card:{id}` SET(JSON, TTL 없음), id=crypto 8자 base36(충돌 시 재생성 3회)
- `nt:cards:recent` LPUSH id + LTRIM 0 199 / `nt:cards:byscore` ZADD score id

엔드포인트:
- POST /api/ping → 검증→hist/stats 갱신→{ok,count,percentile}
- POST /api/share → 검증→카드 저장·인덱스→{ok,id,url}
- GET /api/card?id= → {ok,card} | 404
- GET /api/gallery → {ok, stats:{count,avg,week}, recent:[Card×24], top:[Card×12], bottom:[Card×12]} (MGET 배치, 60s CDN 캐시 헤더)
- GET /api/r?id= → **HTML 응답**(공유 카드 페이지): OG 메타(title "nautli memory score {score} · {grade}", og:image=/assets/og.png), 카드 렌더(2c와 동일 디자인), CTA "내 점수도 재보기 → /diagnose". 404면 안내+진단 링크. 사이트 style.css 링크 재사용 가능.

## 4. 사이트 개편 (`site/src` — build.mjs 파이프라인 통과, en/ko/ja 3로케일 전부)

파일: `site/src/template.mjs`, `site/src/i18n/{en,ko,ja}.json`, `site/src/main.js`, `site/src/gallery.js`(신규), `site/build.mjs`(gallery.js 해시·복사, pages에 "gallery" 추가)

- **diagnose 페이지 1번 경로 교체**: 히어로 = "이 프롬프트를 Claude Code(또는 Cursor·Codex)에 붙여넣으세요" + 프롬프트 박스 + [프롬프트 복사] 버튼(기존 data-copy 관례 재사용). 프롬프트 전문(i18n, 투명성 원칙 — 뭘 읽고 뭘 전송하는지 그대로 명시):
  - en: "Run: npx nautli@latest scan\n\nRead-only diagnosis of the AI memory files on this machine (CLAUDE.md, AGENTS.md, .cursorrules, Obsidian vaults and similar). Nothing is uploaded except 7 anonymous numbers. It opens a local HTML report when done — then summarize the top findings for me."
  - ko/ja 상응 번역. 줄표(—) 한국어 카피에 금지.
  - 아래에 "왜 프롬프트인가" 1줄: "폴더가 어디 있는지 몰라도 됩니다. 당신의 AI는 압니다."
- 기존 브라우저 폴더 스캔은 같은 페이지 하단 `<details>` "브라우저에서 하기(옵시디언 볼트용)"로 강등 — 기존 diagnose.js 플로우·마크업 유지.
- **gallery 페이지 신규**(`/gallery`): 상단 라이브 집계 "N회 진단 · 평균 M점"(/api/gallery), 카드 벽 3탭(최근/명예의 전당/깡통관) — 카드는 2c 디자인 축소판, 클릭 시 /r/:id. 빈 상태(카드 0장) 문구 필수. JS는 gallery.js(diagnose.js와 같은 패턴, 외부 의존 0).
- 내비게이션에 Gallery 추가(en/ko/ja).
- 로케일별 API 경로는 전부 절대경로 `/api/...`(ko/ja 하위경로에서도 동작).

## 5. 보안·프라이버시 불변식 (전 스텝 재확인)
1. 네트워크 송신은 buildPingPayload/buildSharePayload 두 함수 경유만. 파일 경로·이름·스니펫이 포함될 수 있는 어떤 필드도 없음.
2. 서버는 allowlist 외 키 400. nick 새니타이즈. 재계산 가능한 파생값은 전부 서버 재계산.
3. KV 키 nt: 프리픽스 가드 위반 시 throw.
4. scan은 파일시스템 읽기 전용. 어떤 경우에도 스캔 대상 수정 금지.
5. 토큰/시크릿 로그 출력 금지. API 응답에 내부 에러 스택 노출 금지.

## 6. 테스트(신규, `node --test` 통과 필수)
- test/scan-analyze.test.js: 픽스처 문서 배열로 점수·등급·크로스툴 신호·estMonthlyUsd 공식 검증
- test/scan-payload.test.js: buildPingPayload가 허용 키만 방출(오염 입력 포함)
- test/api-validate.test.js: share/ping 검증기를 순수함수로 분리(_validate.js)해 경계값·초과키 400 검증
- ⛔ codex는 테스트 실행·빌드 실행 금지(작성만). 실행은 오케스트레이터가.

## 7. e2e 완료 기준(오케스트레이터 검증)
1. `node src/cli.js scan --json --no-open --no-ping` 실기 실행 → ScanResult 스키마 유효, 이 맥의 claude-code·codex·obsidian 감지
2. 리포트 HTML 실오픈 + 비주얼 QA(겹침·잘림·상태누수 체크리스트)
3. preview 배포에서 curl: ping(percentile), share(url), card, gallery, /r/:id OG 메타 확인
4. `node --test` 전체 그린 + 사이트 3로케일 빌드 산출 확인
