# 자동 캡처 계측 스펙 (TASK-007)

> 배경: sol 2주안 ③ — "후보 승인율·오탐률·검토시간·유용 회상률을 홀드아웃 형식으로 계측, 미달 시 자동 캡처 킬까지 성공 조건". 정본 Evanwiki/신사업/orca-분석-nautli-이식후보.md 부록2.
> 성격: **측정 장치**다. 숫자를 만드는 게 아니라 숫자를 정직하게 뽑는 하니스를 만든다.

## 대원칙 (비대칭 채택 — sol + CLAUDE.md)

- **시뮬/소량 표본의 긍정 신호는 증거가 아니다.** 최소 표본 미달이면 PASS를 줄 수 없고 `INSUFFICIENT_SAMPLE`로만 종료. 낙관적 PASS 금지.
- **판정은 3값**: `PASS`(자동 캡처 유지) / `INSUFFICIENT_SAMPLE`(더 써야 함, 기본값) / `KILL`(수정 루프 후에도 미달 → 자동 캡처 접기).
- 계측은 **로컬 이벤트 로그·큐만** 읽는다(내용 무전송 설계 정합). 원문 claim은 리포트에 넣지 않는다(집계 숫자+유형만).

## §1 데이터 원천 (이미 존재, 신규 로깅 최소)

- capture 카드: `~/.nautli/review/queue.jsonl` `{type:"capture", pair_id, claim_hash, scope, confidence, session_id, project, at(생성), status, action, handled_at, fact_id}`.
- recall 이벤트: `~/.nautli/events/*.jsonl` `{type:"recall", hits:[fact_id...], source, at}`.
- fact 이벤트: `{ev:"fact.added", fact:{id, provenance:{source, session_id, project}}}`. auto = `source==="capture"`.
- **신규 로깅 1건**: capture 카드 결정 시(applyCaptureCard) 이벤트 `{ev:"capture.decided", pair_id, action, confidence, latency_ms: handled_at-at, at}` append(집계 편의+감사). 원문 claim 미포함.

## §2 코호트 정의

- **auto 코호트**: capture 카드(생성된 모든 후보) + 그 승인으로 생긴 fact(provenance.source="capture").
- **explicit 코호트**: source가 capture가 아닌 fact(mcp/cli/review-card 등 유저·AI 직접 remember).
- 회상 기여: recall 이벤트 hits에 등장한 fact_id 집합으로 코호트별 "회상된 적 있는 fact 비율" + "fact당 회상 참조 수".

## §3 지표 `src/capture/metrics.js`

`captureMetrics(home, {now})` → 리포트 객체:
- `auto`: `{candidates(카드 총수), approved(remember), dismissed, deferred, pending, approval_rate=approved/(approved+dismissed), false_positive_rate=dismissed/(approved+dismissed), median_review_latency_ms, facts(승인fact수), recalled_facts, useful_recall_rate=recalled_facts/facts, recall_refs_per_fact}`.
  - 분모가 0인 비율은 `null`(0으로 위장 금지).
- `explicit`: `{facts, recalled_facts, useful_recall_rate, recall_refs_per_fact}` (승인 개념 없음 — 직접 저장이므로).
- `comparison`: `{useful_recall_delta = auto.useful_recall_rate - explicit.useful_recall_rate}` (양쪽 non-null일 때만).
- `sample`: `{decided_cards, auto_facts, explicit_facts, recall_events, first_capture_at, window_days}`.

## §4 홀드아웃 형식 리포트

- vault-doctor results.json과 정합하는 최상위: `{version:1, kind:"capture-metrics", generated_at, sample:{...}, metrics:{auto, explicit, comparison}, verdict, verdict_reason, thresholds}`.
- 원문·경로·claim 필드 부재(테스트로 고정). session_id는 해시로만 카운트(개수), 원값 미노출.

## §5 성공선 / 킬 게이트 (코드화)

`evaluateVerdict(report, thresholds)`:
- **최소 표본 게이트(우선)**: `decided_cards < MIN_DECIDED(기본 20)` 또는 `recall_events < MIN_RECALL(기본 10)` → `INSUFFICIENT_SAMPLE`(이유 명시). 아래 임계는 평가하지 않음.
- 표본 충족 시:
  - `PASS` 조건(전부 만족): `approval_rate >= 0.5` AND `false_positive_rate <= 0.5` AND `auto.useful_recall_rate >= EXPLICIT의 0.5배`(자동이 수동의 절반 이상은 회상에 기여).
  - `KILL`: 위 PASS 조건 미달. (007은 v1이므로 "수정 루프 후 미달=KILL"의 판정 자체를 내되, 실제 킬 결정은 유저 — 리포트에 KILL 사유+수정 후보 명시.)
- 임계는 `thresholds` 인자로 주입 가능(테스트·튜닝). 기본값은 상수로 노출.

## §6 CLI / 대시보드

- `nautli capture metrics [--json]` — 표: 판정 배지 + 승인율/오탐률/검토시간/유용회상률(auto vs explicit) + 표본. `--json`은 §4 리포트.
- 대시보드는 이번 스코프 아님(v2). CLI만.

## §7 정직성 산출물

- 리포트 상단에 항상 `sample.window_days`와 판정. `INSUFFICIENT_SAMPLE`이면 "실사용 N일 더 필요, 현재 결정 X/20·회상 Y/10" 사람말 1줄.
- **현재 실제 상태를 그대로 보고**: 어제 실 세션 capture 카드 3건이 pending(결정 0)이면 판정=INSUFFICIENT_SAMPLE, 승인율=null. 이게 정확한 출력이다(하니스가 작동하는 증거 = 없는 숫자를 만들지 않는 것).

## 성공 기준 (착수 앵커)

1. 격리 홈에 합성 이벤트·큐(auto 승인 12·버림 6·회상 이벤트 15 등)를 심어 captureMetrics가 승인율·오탐률·검토시간·유용회상률·delta를 스키마대로 산출, 분모 0은 null (30)
2. evaluateVerdict 3값 전부 재현: 표본미달→INSUFFICIENT_SAMPLE, 충족+양호→PASS, 충족+미달→KILL. 최소표본 게이트가 임계평가보다 우선 (25)
3. 리포트에 원문 claim·경로 필드 부재(테스트 고정) + session_id 원값 미노출 (15)
4. CLI 표·--json 실행, 실제 ~/.nautli(카드 3 pending)에서 INSUFFICIENT_SAMPLE+null 정직 출력 (15)
5. 신규 capture.decided 이벤트가 applyCaptureCard에서 기록되고 rebuild가 이를 fact로 오인하지 않음(기존 이벤트 계약) (10)
6. 기존 테스트 106/106 유지 (5)
