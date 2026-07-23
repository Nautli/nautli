# 지식 전달 감사 원장 v1 스펙 (lite)

> TASK-095 · 2026-07-23 · 해자 논의 R2(`Evanwiki/신사업/nautli-자율AI시대-해자-논의-2026-07-23.md`) 후속.
> **범위**: 스펙+fixture만. 코드 변경 없음. 격리(TASK-096)·논리 롤백(TASK-102)·삭제 영수증(TASK-103)·해시체인은 다루지 않는다.
> **목적**: "어떤 fact의 어떤 버전이, 언제 어떤 판정을 거쳐, 어느 세션에 건네졌는가"를 질의 가능하게 하는 이벤트 체계 정의 — 현행 구현 대비 갭을 명시하고 후속 dev 태스크로 분해한다.

---

## 0. 용어와 시간축

- **fact**: 원자 claim 1개를 담는 불변 레코드. 수정은 없고 **새 fact가 구 fact를 supersede** 한다.
- **버전**: nautli에는 "fact_id+버전번호" 이원 체계가 없다. **fact_id 자체가 버전 ID**다 — 갱신 시 새 `fa_` id가 발급되고 구본의 `superseded_by`에 새 id가 스탬프된다. 버전 체인 = `superseded_by` 링크드 리스트. 감사 원장은 이 체계를 그대로 쓴다(버전번호 신설 안 함 — 킬조건 원칙: 이미 되는 건 재발명 금지).
- **시간 2축(bi-temporal)**:
  - *validity time*: `t_valid`/`t_invalid` — 세상에서 사실이 참이던 기간.
  - *transaction time*: `t_created`/이벤트 `at` — 시스템이 그것을 알게 된/기록한 시각.
  - Q1 as-of는 기본 **validity 축**(현행 `recall --as-of` 구현과 동일 의미론, `src/core/recall.js` `visibleAt()`). transaction 축 as-of("그때 시스템이 뭘 알았나")는 이벤트 리플레이로 정의한다(§4 Q1-T).

## 1. 식별자 체계

| 식별자 | 형식 | 발급처 | 역할 |
|---|---|---|---|
| `fact_id` | `fa_` + ts(base32 10자리) + rand 13자리 (`schema.js newId`) | remember/소화 적재 시 | fact = 버전의 전역 유일 ID |
| `claim_hash` | sha1(정규화 claim) | 적재 시 | 내용 중복 감지(버전 동일성 아님) |
| `pair_id` | `cap:` + sha1 | 자동캡처 큐 | 캡처 카드 ↔ 판정 이벤트 연결 |
| `session_id` | 호출자 제공 문자열(자유형) | recall/briefing 호출 시 | 전달 대상 세션 식별 (**현행: 코어는 지원, MCP 서버가 미전파 — §5 갭 G1**) |
| `ev_id` | **신설 제안** `ev_` + ts + rand | appendEvent 시 | 이벤트 유일 ID — 중복 판정·리플레이 멱등성 기준 (§3) |
| `policy_version` | **신설 제안** 문자열(예: `triage@3`, `resolver@2026-07-19`) | 판정 이벤트 발행 시 | "어느 규칙으로 판정했나" 스탬프 (§5 갭 G3) |

## 2. 이벤트 타입 목록 (현행 실측 + 필수 필드)

저장소: `~/.nautli/events/YYYY-MM.jsonl` (월별 append-only JSONL). 2026-07 실측 분포: fact.added 2375 / capture.decided 921 / recall 215 / fact.superseded 102 / shadow.resolve_cycle 55 / fact.invalidated 28.

원장 관점 분류 — **[생성] → [판정] → [전달]** 세 단계가 감사 체인의 뼈대다.

| 이벤트 | 단계 | 필수 필드 (현행) | 원장 v1 추가 필수 (제안) |
|---|---|---|---|
| `fact.added` | 생성 | `at`, `fact{id, scope, claim, provenance, t_valid, t_created, status, claim_hash}`, `source` | `ev_id` |
| `fact.superseded` | 판정 | `at`, `id`(구본), `patch{superseded_by, t_invalid}` | `ev_id`, `actor`(daemon/client/undo), `reason`, `policy_version` |
| `fact.invalidated` | 판정 | `at`, `id`, `patch{t_invalid}` | 동상 |
| `capture.decided` | 판정 | `at`, `pair_id`, `action`, `confidence`, `latency_ms`, (`answered_by`, `fact_id`) | `ev_id`, `policy_version`; `fact_id`는 remember로 이어진 경우 **필수**로 승격 |
| `shadow.confirmed` | 판정 | `at`, `undo_id`, `action` | `ev_id`, 대상 `fact_id` |
| `undo.applied` | 판정 | `at`, undo 대상 정보 | `ev_id`, `fact_id`, 복원 전후 상태 |
| `recall` (`tool: recall\|briefing`) | 전달 | `at`, `tool`, `query`, `scope`, `hits[]`(fact_id 배열), `source`, `returned_chars` | `ev_id`, `session_id` **필수화**(미상이면 `"unknown"` 명시 기록 — 결측과 구분) |
| `fact.purged` | 파기 | `at`, `fact_ids[]`, `source` | `ev_id`, `reason` (TASK-103 연동) |
| `shadow.resolve_cycle` | 운영 | 집계 카운트 | 원장 비대상(fact 단위 아님) — 유지만 |
| `session_start.index` | 운영 | — | 원장 비대상 |

**필드 규약**: `at`은 ISO-8601 UTC. 원장 대상 이벤트는 fact를 `fact_id`로 지칭(내용 임베드는 fact.added만). 판정 이벤트의 `actor`는 `schema.js assertTransition`의 actor enum(daemon/client/undo)과 동일 값을 쓴다 — 새 enum 발명 금지.

## 3. 순서·중복 규칙

- **순서**: 단일 홈(`~/.nautli`) 기준 append-only. 정렬 기준은 ①파일명(월) ②파일 내 라인 순서. `at` 동률 시 라인 순서가 정본이다. `at`은 표시용이지 순서의 근거가 아니다. (멀티프로세스 동시 append 잠금은 TASK-001 소관 — 본 스펙은 "라인 순서=정본" 규칙만 고정.)
- **중복**: 현행은 `fact.purged` tombstone만 dedup 가드(`hasPurgeTombstone`)가 있고 나머지는 없다. v1 규칙: **`ev_id` 도입 후, 리플레이·질의는 `ev_id` 기준 멱등**(같은 ev_id 재등장 시 1회로 계산). ev_id 없는 과거 이벤트는 `(ev, at, 대상 id, 라인 위치)` 튜플로 사실상 유일 취급(레거시 규칙).
- **정정**: 이벤트는 수정·삭제하지 않는다. 잘못 기록된 이벤트도 남기고, 정정은 새 이벤트로만. 유일 예외 = `fact.purged`에 따른 소급 스크럽(`scrubEventFiles` — 본문 파기 요구와 감사 보존의 교차점, 한계는 §6에 명시).

## 4. 보존기간

- **원장 대상 이벤트(§2 표의 생성/판정/전달/파기)**: 무기한 보존. 로테이션·압축은 해도 되나 삭제는 금지. 유일 예외는 purge 스크럽(본문만 제거, tombstone 이벤트는 남음).
- **운영 이벤트**(resolve_cycle, session_start.index): 보존 의무 없음 — 12개월 후 삭제 가능.
- 현행 구현은 어떤 로테이션도 없음(전부 무기한) → 현 시점 v1 규칙과 이미 합치. 별도 작업 불요.

## 5. 감사 질의 3종 + 고정 fixture 기대값

### Fixture F1 (고정 입력 이벤트 시퀀스)

scope `project:demo`, 세션 `S1`, `S2`. 시간은 전부 UTC.

```jsonl
{"ev":"fact.added","at":"2026-07-01T09:00:00Z","source":"mcp","fact":{"id":"fa_A1","scope":"project:demo","claim":"서버 포트는 3000이다","provenance":{"source":"mcp"},"t_valid":"2026-07-01","t_invalid":null,"t_created":"2026-07-01T09:00:00Z","superseded_by":null,"status":"active","claim_hash":"h1"}}
{"type":"recall","tool":"briefing","at":"2026-07-02T08:00:00Z","query":"","scope":"project:demo","hits":["fa_A1"],"source":"mcp","session_id":"S1","returned_chars":120}
{"ev":"fact.added","at":"2026-07-03T10:00:00Z","source":"mcp","fact":{"id":"fa_A2","scope":"project:demo","claim":"서버 포트는 3200으로 변경됐다","provenance":{"source":"mcp"},"t_valid":"2026-07-03","t_invalid":null,"t_created":"2026-07-03T10:00:00Z","superseded_by":null,"status":"active","claim_hash":"h2"}}
{"ev":"fact.superseded","at":"2026-07-03T10:00:01Z","id":"fa_A1","patch":{"superseded_by":"fa_A2","t_invalid":"2026-07-03"},"actor":"client","reason":"user supersedes via remember","policy_version":"n/a"}
{"type":"recall","tool":"recall","at":"2026-07-04T14:00:00Z","query":"서버 포트","scope":"project:demo","hits":["fa_A2"],"source":"mcp","session_id":"S2","returned_chars":80}
{"ev":"fact.added","at":"2026-07-05T03:30:00Z","source":"daemon","fact":{"id":"fa_B1","scope":"project:demo","claim":"배포는 vercel로 한다","provenance":{"source":"capture"},"t_valid":"2026-07-05","t_invalid":null,"t_created":"2026-07-05T03:30:00Z","superseded_by":null,"status":"active","claim_hash":"h3"}}
{"ev":"capture.decided","at":"2026-07-05T03:30:00Z","pair_id":"cap:xyz","action":"remember","confidence":0.8,"latency_ms":1000,"fact_id":"fa_B1","policy_version":"triage@3"}
{"ev":"fact.invalidated","at":"2026-07-06T03:30:00Z","id":"fa_B1","patch":{"t_invalid":"2026-07-06"},"actor":"daemon","reason":"contradiction resolved against fa_B1","policy_version":"resolver@2"}
```

### Q1 — as-of: "시점 t에 scope S에서 유효했던 fact 집합은?"

정의(validity 축): `{ f | f.scope=S ∧ f.t_valid ≤ t ∧ (f.t_invalid = null ∨ f.t_invalid > t) ∧ f.status ≠ purged }`. 현행 `recall(as_of)` `visibleAt()`과 동일 의미론.

| 입력 | 기대 출력 (fact_id 집합) |
|---|---|
| t=2026-07-02, S=project:demo | `{fa_A1}` |
| t=2026-07-04, S=project:demo | `{fa_A2}` (fa_A1은 t_invalid=07-03 ≤ t로 제외) |
| t=2026-07-05, S=project:demo | `{fa_A2, fa_B1}` |
| t=2026-07-07, S=project:demo | `{fa_A2}` (fa_B1 invalidated) |

**Q1-T(transaction 축, 참고 정의)**: "시점 t까지의 이벤트만 리플레이한 스토어에서 위 질의" — TASK-102 롤백 검증이 재사용할 정의. v1 도구화 대상은 아님.

### Q2 — 전달 추적: "fact F(버전 v)는 어느 세션에 언제 건네졌나?"

정의: `recall` 이벤트 중 `F ∈ hits`인 것들을 `(at, tool, session_id, query, scope)`로 나열. 버전 v = fact_id 그 자체(§0)이므로 별도 버전 매개변수 없음. 체인 전체 추적은 superseded_by 링크를 따라 각 버전 id로 반복.

| 입력 | 기대 출력 |
|---|---|
| F=fa_A1 | `[(2026-07-02T08:00Z, briefing, S1)]` |
| F=fa_A2 | `[(2026-07-04T14:00Z, recall, S2)]` |
| F=fa_B1 | `[]` (전달 이력 없음) |
| 체인(fa_A2 기준 전 버전 포함) | fa_A1→S1(07-02), fa_A2→S2(07-04) — "포트 지식은 S1에 구버전, S2에 신버전이 전달됨" |

### Q3 — 판정 근거: "fact F가 현재 상태가 된 판정 체인은?"

정의: F에 대한 `fact.added` → (있으면) `capture.decided`(fact_id=F) → F를 대상으로 한 `fact.superseded`/`fact.invalidated`/`undo.applied` 이벤트를 시간순 나열, 각각의 `actor`/`reason`/`policy_version` 포함. supersede의 경우 후속 버전 id를 병기.

| 입력 | 기대 출력 |
|---|---|
| F=fa_A1 | `added(07-01, mcp)` → `superseded(07-03, actor=client, by=fa_A2, reason="user supersedes via remember")` — 현재 상태: superseded |
| F=fa_B1 | `added(07-05, daemon)` + `capture.decided(action=remember, conf=0.8, policy=triage@3)` → `invalidated(07-06, actor=daemon, reason="contradiction resolved...", policy=resolver@2)` — 현재 상태: invalidated |

## 6. 현행 로그·스키마 대비 갭 표 + 킬조건 검사

**킬조건 검사 수행 결과 (2026-07-23, 코드·이벤트 로그 실측)**: 3질의 중 **Q1은 현행만으로 가능, Q2·Q3는 부분 가능** — 따라서 "질의 레시피 문서화만으로 종료" 조건은 **불충족**. 필드 추가가 필요하다. 상세:

| 질의 | 현행 가능? | 근거 | 빠진 것 |
|---|---|---|---|
| Q1 (validity as-of) | ✅ 가능 | SQLite `facts`가 superseded/invalidated 행을 보존하고 `t_valid/t_invalid` 보유. `recall.js`에 `as_of` 구현 존재 | 없음. CLI 노출(`nautli recall --as-of`)은 TASK-024와 병합 |
| Q1-T (transaction as-of) | ⚠️ 원리상 가능 | 이벤트 리플레이(`store.js` REPLAY 로직)로 재구성 가능 | 도구 없음(v1 비대상, 102가 소비) |
| Q2 (전달 추적) | ⚠️ 부분 | recall 이벤트에 `hits[]`·`tool`·`returned_chars` 기록됨. briefing도 `tool:"briefing"`으로 로깅됨. `session_id` 필드는 코어가 지원 | **G1** (~~MCP 서버가 session_id를 전파하지 않아 실데이터 전량 결측~~): **resolved — 2026-07-23, TASK-104** (MCP recall/briefing이 session_id 전파, 미상은 `"unknown"`). **G2** (~~handoff-card 등 recall 외 전달 경로 로깅 여부 전수 확인~~): **resolved — 2026-07-23, TASK-104** (session-start.index·handoff-card·dashboard.memory/graph/cards·generated-view 전달 로깅) |
| Q3 (판정 근거) | ⚠️ 부분 | `superseded_by` 체인은 DB·이벤트 양쪽에서 재구성 가능. capture.decided에 action/confidence 있음 | **G3** (~~판정 이벤트에 actor·reason·policy_version 없음~~): **resolved — 2026-07-23, TASK-104** (superseded/invalidated·capture.decided에 스탬프). G4: capture.decided→fact_id는 remember 결정에서 필수로 승격됨(TASK-104). **G5** (~~ev_id 부재~~): **resolved — 2026-07-23, TASK-104** (appendEvent가 ev_id 발급, 리플레이·감사 first-wins 멱등) |

### 후속 dev 태스크 분해안 (백로그 적재 후보 — 적재는 별도 승인)

1. **D1 (G1)** — **resolved — 2026-07-23, TASK-104**: MCP recall/briefing 핸들러에 클라이언트 세션 식별자 전파(+ 미상 시 `"unknown"` 명기). CLI `--session` 옵션은 후속(TASK-104 범위 밖).
2. **D2 (G3)** — **resolved — 2026-07-23, TASK-104**: `fact.superseded`/`fact.invalidated`/`capture.decided` 발행부(store.js·review.js·daemon apply/resolve)에 `actor`·`reason`·`policy_version` 스탬프. policy_version 상수(`TRIAGE_POLICY_VERSION="triage@3"`·`RESOLVER_POLICY_VERSION="resolver@2"`)는 triage/resolver 모듈에 선언.
3. **D3 (G5)** — **resolved — 2026-07-23, TASK-104**: `appendEvent`에 `ev_id` 자동 발급 + 리플레이·감사 first-wins 멱등(`readLogicalEvents`, TASK-105 소비 API).
4. **D4**: 감사 질의 CLI `nautli audit as-of|delivery|verdict` — §5 정의 그대로 구현, F1 fixture를 유닛테스트로 동봉. (별도 태스크 — 미완)
5. **D5 (G2)** — **resolved — 2026-07-23, TASK-104**: 전달 경로 전수 감사 — session-start.index(치료군 한정)·handoff-card·dashboard.memory/graph/cards·generated-view를 `type:"recall"` 전달 이벤트로 로깅.

## 7. 한계 명시 (정직 원칙)

- 이 원장은 **nautli가 건네준 것**까지만 증언한다. 세션(에이전트)이 그 fact로 무엇을 했는지(행동)는 관측 밖 — "행동책임 원장" 류 표현 금지(해자 R2 합의).
- purge 스크럽은 이벤트 본문을 소급 제거하므로, purge된 fact의 Q2/Q3는 tombstone 이후 불완전하다. 이 긴장의 해소(잔존 메타 범위)는 TASK-103 소관.
- JSONL은 위변조 방지가 없다(해시체인 비대상 — 해자 R2에서 명시 제외). 원장의 신뢰 단위는 "로컬 파일을 소유한 유저 자신"이다.
