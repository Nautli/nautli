# onebrain v0 빌드 스펙 (정본 — 구조설계 v1의 실행형)

모든 코드는 이 스펙을 따른다. 스펙에 없는 기능 추가 금지(YAGNI). Node 22, ESM("type":"module"), 의존성은 better-sqlite3, @modelcontextprotocol/sdk, zod만 (이미 설치됨). 새 의존성 추가 금지.

## 0. 공통
- `ONEBRAIN_HOME` env로 홈 오버라이드, 기본 `~/.onebrain`. 모든 모듈은 홈 경로를 인자/env로만 받는다 (하드코딩 금지).
- 브랜드 문자열은 `src/brand.js`의 `export const BRAND = "onebrain"` 한 곳만.
- **불변식(위반=버그)**: ①`facts` 테이블에 SQL `DELETE FROM facts` 금지 — 상태 전이만 (파생 인덱스 facts_fts는 DELETE 허용) ②recall/briefing 출력은 fact 필드+고정 템플릿만으로 조립 (프로모션·광고 문자열 injection 지점 자체가 없어야 함) ③이벤트 로그는 append-only ④데몬 스테이지는 전부 멱등.

## 1. 파일 레이아웃 (전부 신규 생성)
```
src/brand.js
src/core/schema.js    # 에러코드·상태머신·검증·id
src/core/store.js     # 이벤트로그 + SQLite 인덱스 + rebuild
src/core/gate.js      # remember 쓰기 게이트
src/core/recall.js    # recall 랭커 + briefing
src/mcp/server.js     # stdio MCP 서버
src/cli.js            # CLI
src/daemon/pair.js    # 후보쌍
src/daemon/judge.js   # LLM 판정 (BYO CLI)
src/daemon/apply.js   # 상태 전이 적용
src/daemon/report.js  # 밤새 리포트
src/daemon/render.js  # 옵시디언 뷰
src/daemon/pipeline.js
test/gate.test.js test/store.test.js test/recall.test.js
test/invariants.test.js test/daemon.test.js test/e2e.test.js
test/fixtures/mock-judge.js
```

## 2. 저장소 (홈 아래)
```
events/YYYY-MM.jsonl   # append-only 정본. 줄당 이벤트 1개
index.sqlite           # 파생 (WAL). 삭제 후 rebuild로 완전 복구되어야 함
review/queue.jsonl     # 리뷰큐
reports/YYYY-MM-DD.md
views/<scope-slug>.md
daemon/journal.jsonl   # 판정 완료 쌍 키 기록 (멱등)
config.json            # {"default_scope":"person","judge_cmd":null}
```
이벤트 형식: `{"ev":"fact.added","at":"ISO","fact":{...}}` / `fact.superseded|fact.invalidated|fact.archived|fact.restored`: `{"ev":"...","at":"ISO","id":"fa_..","patch":{...}}`

## 3. src/core/schema.js
```js
export const ERR = { E_INVALID_INPUT, E_MULTI_FACT, E_CLAIM_TOO_LONG, E_UNKNOWN_SCOPE,
  E_NOT_FOUND, E_STORE_BUSY, E_BUDGET_TOO_SMALL, W_DUPLICATE, W_EMPTY }  // 문자열 상수
export const STATUS = { ACTIVE:'active', SUPERSEDED:'superseded', INVALIDATED:'invalidated', ARCHIVED:'archived' }
export function newId(now=Date.now())        // "fa_"+시간정렬 가능 26자 (타임스탬프 base32 + 랜덤)
export function validScope(s)                 // person | procedure | project:<slug>
export function normalizeClaim(s)             // lowercase+공백압축+구두점 제거 (dup 해시용)
export function claimHash(s)                  // sha1(normalizeClaim)
export function assertTransition(from, to, actor) // actor: 'client'|'daemon'. 허용: daemon: active→superseded|invalidated|archived, archived→active. client: active→superseded만. 위반 시 throw
```
fact 레코드 필드: id,type(episodic|semantic|procedural),scope,subject,claim,confidence,provenance(JSON),t_valid,t_invalid,t_created,t_expired,superseded_by,status,claim_hash

## 4. src/core/store.js — class Store
```js
new Store(home)                 // 디렉토리 보장 + sqlite 오픈(WAL) + 스키마 마이그레이션
store.appendEvent(evt)          // events/YYYY-MM.jsonl에 appendFileSync + applyEvent(인덱스 반영)
store.applyEvent(evt)           // 멱등: fact.added는 INSERT OR IGNORE, patch류는 UPDATE
store.addFact(fact)             // appendEvent 래퍼 (t_created 자동)
store.transition(id, to, patch, actor) // assertTransition 후 해당 이벤트 append. DELETE 금지
store.getFact(id) / store.byHash(hash) / store.query({scope,subject,status,limit})
store.searchFts(text, {scope, limit}) // facts_fts bm25, [{id, rank}]
store.rebuild()                 // index.sqlite 재생성: events/*.jsonl 시간순 전체 리플레이
store.stats()                   // {total, byStatus, byScope}
store.close()
```
SQLite: 구조설계 §5의 facts 테이블+인덱스. FTS는 별도 테이블 `facts_fts(id UNINDEXED, claim, subject)` — insert 시 동기 기입, transition으로 status가 active 아니게 되면 fts 행 제거(파생이라 DELETE 허용), rebuild 시 재구성.

## 5. src/core/gate.js
```js
export function remember(store, input, config)
// input: {claim, type?, scope?, subject?, supersedes?, t_valid?, confidence?}
// 반환: {id, status:'added'|'duplicate'|'rejected', reason?}
```
순서: ①claim 문자열·비어있지 않음(E_INVALID_INPUT) ②길이>280 → E_CLAIM_TOO_LONG ③멀티팩트 휴리스틱: 개행 불릿(`\n-`,`\n*`,`\n1.`) 또는 "; " 3분절 이상 → E_MULTI_FACT ④scope 기본값=config.default_scope, validScope 실패 → E_UNKNOWN_SCOPE ⑤supersedes 지정 시 존재 확인(E_NOT_FOUND), 있으면 addFact 후 구 fact를 client actor로 superseded 전이 ⑥claimHash 일치 active fact 존재 → {기존id, 'duplicate', W_DUPLICATE} ⑦addFact → {id,'added'}. LLM 호출 없음. type 기본 episodic, confidence 기본 0.7, t_valid 기본 오늘.

## 6. src/core/recall.js
```js
export function recall(store, task, opts)
// opts: {budget_tokens=2000, scope, as_of, include_archived=false}
// 반환: {briefing, facts:[{id,claim,t_valid,confidence,scope}], tokens_used}
export function briefing(store, context, scope, config) // recall 프리셋 (semantic 상위+최근 episodic+scope procedural)
```
- budget<200 → throw ERR.E_BUDGET_TOO_SMALL
- 후보: searchFts(task) 결과. **scope가 명시된 경우에만** 해당 scope 최근 30건을 union (v1 리뷰 결정: scope 없는 순수 텍스트 질의에 최근 노이즈를 섞지 않음 — 무관 task는 W_EMPTY가 정답). status 필터: 기본 active만, as_of 지정 시 `t_valid<=as_of AND (t_invalid IS NULL OR t_invalid>as_of)`이면 superseded/invalidated도 포함(그 시점엔 참이었으므로).
- 점수 = ftsNorm(0~1, 매치 없으면 0.3) × exp(-일수/90) 반감 × confidence × (scope 일치 1.0 / person 0.8)
- 예산 패킹: 점수순 그리디, 토큰 추정 = ceil(chars/3). 결과 0건 → {briefing:"", facts:[], tokens_used:0, warning:'W_EMPTY'}
- briefing 렌더: 줄당 `- [{scope}] {claim} ({t_valid의 M/D} 기준, 확신 {confidence})` — 이 템플릿 외 문자열 조립 금지.

## 7. src/mcp/server.js (stdio)
@modelcontextprotocol/sdk McpServer + StdioServerTransport. 툴 3개 (zod 스키마):
- `remember {claim:string, type?, scope?, subject?, supersedes?, t_valid?, confidence?}` → gate.remember 결과 JSON
- `recall {task:string, budget_tokens?, scope?, as_of?}` → recall 결과 JSON
- `briefing {context?, scope?}` → briefing 결과 JSON
에러는 throw 대신 `{error: ERR코드, message}` JSON 반환 (에이전트가 분기하게). 서버명 BRAND, version 0.1.0.

## 8. src/cli.js (bin: onebrain)
서브커맨드: `init`(홈 생성+config), `remember <claim> [--scope --type --supersedes]`, `recall <task> [--budget --scope --as-of]`, `rebuild`, `stats`, `daemon-run [--dry]`(pipeline.runOnce 1회), `doctor`(홈 존재·sqlite 정합·이벤트수 vs 인덱스수 일치 체크), `mcp`(stdio 서버 기동). 출력은 JSON(사람용 꾸밈 금지). process.exitCode 규약: 성공0/거부2/에러1.

## 9. 데몬 (src/daemon/*)
- `pair.js findPairs(store, {simFloor=0.25, topK=5})`: active fact 전수, 같은 scope 블로킹, FTS로 상대 후보, 문자 2-gram 코사인(subject 일치 +0.08). journal에 있는 쌍 제외. 반환 [{a,b,sim}].
- `judge.js judgePairs(pairs, store, config)`: 20쌍 배치로 config.judge_cmd(기본 `claude --model sonnet -p <프롬프트>`) spawn, stdin에 JSONL, stdout JSONL 파싱 → [{pair_id, verdict:duplicate|contradiction|related|unrelated, confidence, newer, reason}]. 프롬프트는 PoC 검증본(파일 상수). `config.judge_cmd`가 배열이면 [cmd, ...args]로 spawn (테스트는 mock-judge.js 지정).
- `apply.js applyJudgments(store, judgments, config)`: verdict별 게이트 (2026-07-11 유저 라벨 실측으로 확정) —
  | verdict | conf | 처리 |
  |---|---|---|
  | duplicate | ≥0.9 | 자동 병합: 낡은 쪽(t_valid 과거, 동률이면 confidence 낮은 쪽) superseded (실측 정밀도 10/10) |
  | duplicate | 0.6~0.9 | 리뷰큐 |
  | contradiction | ≥0.6 전부 | **항상 리뷰카드 — 자동 무효화 금지가 기본값** (실측: 고신뢰 5장 중 2장 유저정정 — 죽은 프로젝트 신호·기록≠현재 의도). `config.contradiction_auto=true` opt-in시에만 conf≥0.9 & newer 확정 → invalidated |
  | 공통 | <0.6 / related / unrelated | no-op (틀린 병합보다 중복이 싸다) |
  전 건 journal 기록. 반환 {applied, queued, skipped}. 정책 고정 테스트 = test/policy.test.js
- `report.js writeReport(store, home, results)`: reports/YYYY-MM-DD.md — 요약 1줄 + pending 리뷰카드 최대 3장(초과 이월 표기). **카드 문구 규칙(유저 실측 피드백 2026-07-11, 2건): ①분류 질문 금지 — "데몬이 하려는 행동"의 승인형(O/X/모름/기타-텍스트)으로, 각 claim에 출처 파일·날짜 병기, 모름=집계 제외 ②기술 claim 원문을 그대로 묻지 말 것 — 카드 상단에 사람 언어 한 줄 번역 필수("PDF 읽는 부품을 새것으로 갈았다는 기록이 있어서 옛 기록을 접으려고 해"), 기술 원문은 하단 참고로 축소.** 사람은 4지선다 분류를 못 하고, AI가 대신 쌓은 기억은 본인도 기억 못 하며, 기술 용어("pdf-parse v2 getText()")는 데이터 주인에게도 외국어다. 번역 문장은 데몬 report 단계에서 LLM이 생성.
**카드 라우팅 규칙(유저 3차 피드백 2026-07-11)**: ①**오라클 라우팅** — 질문은 그 답을 아는 주체에게. 기술·코드 기록(provenance가 레포·세션)은 유저 카드 금지: 정답은 레포(ground truth 대조)이거나, 대조 불가 시 보수 no-op. 유저 카드는 유저가 오라클인 것만(사업 결정·선호·사람·프로젝트 방향) ②**중복 병합은 카드 대상 제외**(non-lossy라 오판해도 복구 가능) — 카드는 모순 무효화만 ③UI: 거부(X) 버튼에 위험색 idle 스타일 금지 — 미선택인데 켜진 것처럼 보임(실측 혼동).
- `render.js renderViews(store, home)`: scope별 md — active fact를 subject 그룹으로 불릿. 프론트매터 `generated: true` + "onebrain이 생성한 읽기전용 뷰" 1줄.
- `pipeline.js runOnce(store, home, config, {dry})`: pair→judge→apply→report→render 순차, 각 스테이지 완료를 daemon/journal.jsonl에 기록, dry면 judge/apply 스킵하고 쌍 수만 보고.

## 10. 테스트 (node --test, 각 테스트는 mkdtemp 홈 사용)
- gate.test.js: 281자 거부 / 불릿 멀티팩트 거부 / 같은 claim 2회 → 2번째 duplicate+같은 id / scope "foo" 거부 / supersedes 미존재 → rejected E_NOT_FOUND / supersedes 정상 → 구 fact superseded
- store.test.js: addFact 20건 후 query 개수 일치 / transition 후 상태 반영 / **rebuild 왕복: index.sqlite 삭제→rebuild→query·recall 결과 동일** / applyEvent 중복 적용해도 결과 불변(멱등)
- recall.test.js: A→B→C supersede 체인에서 recall은 C만 / as_of 과거시점은 A / tokens_used ≤ budget / budget 100 → E_BUDGET_TOO_SMALL throw / 무관 task → W_EMPTY
- invariants.test.js: src/ 전 파일 grep — `DELETE FROM facts`(공백 포함) 부재(단 `facts_fts`는 예외) / recall.js에 문자열 연결로 외부 설정값이 briefing에 들어갈 경로 부재(템플릿 함수 단일) / assertTransition: client가 active→invalidated 시도 → throw
- daemon.test.js: fixtures/mock-judge.js(stdin 쌍 받아 사전정의 verdict 반환: 쌍1 duplicate 0.95, 쌍2 contradiction 0.95 newer=b, 쌍3 duplicate 0.7, 쌍4 unrelated) → runOnce 후: 쌍1 낡은쪽 superseded / 쌍2 낡은쪽 invalidated+t_invalid 기입 / 쌍3 큐에 pending / 쌍4 no-op / **runOnce 재실행 시 이중 적용 0(저널 멱등)** / report 파일 존재+카드≤3
- e2e.test.js: CLI 경유 전체 스토리 — init→remember 5건(모순쌍 포함: "포트는 3000" 나중에 "포트는 4000")→daemon-run(mock judge)→recall "포트" → 4000만+날짜꼬리표→recall --as-of 과거 → 3000→rebuild→recall 동일→stats 정합
- mock-judge.js: stdin JSONL 읽고 claim 내용 규칙(예: "포트" 포함 쌍=contradiction newer=늦은쪽)으로 verdict JSONL 출력하는 단독 node 스크립트
