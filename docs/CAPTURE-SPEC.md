# 자동 캡처 스펙 (TASK-005/006/007)

> 배경 정본: Evanwiki/신사업/orca-분석-nautli-이식후보.md 부록2 (sol 설계 메모).
> 원칙: 동의 없는 파서 금지(기반이 선행). 훅은 힌트, checkpoint가 진실원. 후보 자동 활성화 금지. raw transcript 복사 금지.

## §1 기반 (TASK-005 — 이 스펙의 구현 범위)

### 1.1 프로젝트 opt-in (consent)
- 저장: `~/.nautli/config.json`의 `capture_projects`: `{ "<realpath>": { enabled: true, opted_at: iso } }`. 키는 반드시 realpath 정규화.
- API `src/capture/consent.js`: `isProjectOptedIn(home, projectPath)`, `setProjectOptIn(home, projectPath, enabled)`, `listOptedProjects(home)`.
- CLI: `nautli capture on <path>` / `capture off <path>` / `capture status`. path 생략 시 cwd. off는 기록을 enabled:false로 남김(재동의 이력).
- 기본값: 아무것도 opt-in 안 됨. opt-in 없는 프로젝트의 세션은 어떤 코드 경로도 읽지 않는다(가드는 §2 캡처 진입점에서 throw가 아니라 skip).

### 1.2 Redaction `src/capture/redaction.js`
- `redactText(text)` → `{ text, findings: [{kind, count}] }`. 원문은 반환하지 않고 마스킹 결과만.
- 마스킹 토큰: `«redacted:<kind>»`.
- kind 목록(v1): `private-key`(PEM 블록), `aws-key`(AKIA[0-9A-Z]{16}), `github-token`(ghp_/gho_/ghs_/github_pat_), `slack-token`(xox[baprs]-), `bearer`(Authorization/Bearer 뒤 토큰), `assignment`((api[_-]?key|secret|token|passwd|password)\s*[:=]\s*값 — 값만 마스킹), `high-entropy`(공백 없는 24자+ base64/hex 꼴 && Shannon 엔트로피 ≥4.0, 단 URL 경로·한글 포함 문자열 제외).
- `previewRedaction(text)` = 같은 로직, 저장 없음(대시보드/CLI 프리뷰용).
- 불변식: 픽스처의 시크릿 문자열이 출력에 1글자도 남지 않는다. 일반 한국어/영어 산문·코드 스니펫(시크릿 없는)은 무변경.

### 1.3 Secure spool `src/capture/spool.js`
- 디렉토리: `~/.nautli/capture/spool` — 생성 시 mode 0700(기존이면 chmod 재강화).
- `writeSpoolEntry(home, entry)`: JSON 1건 = 1파일(`<ulid|ts-rand>.json`), tmp(0600)+rename 원자쓰기. 엔트리에 raw 대화 원문 금지 — redaction 통과분만.
- `listSpoolEntries(home)`, `removeSpoolEntry(home, id)`, `spoolStats(home)`.
- 외부 의존성 금지(node 내장). 패턴은 자체 구현(Orca 코드 복사 아님 — vendor 고지 불필요).

### 1.4 완전삭제 cascade (store)
- 정본이 이벤트 로그이므로 완전삭제 = 3단계:
  1. `events/*.jsonl` 스크럽: 대상 fact_id의 fact.added/전이 이벤트 라인을 제거한 새 파일을 tmp+rename로 교체(파일당 1세대 `.bak` 롤링). recall/조회 이벤트에 fact_id만 있고 내용 없는 건 유지.
  2. tombstone 추가: `{ev:"fact.purged", fact_ids:[...], at}` — 내용(claim 등) 없이 id만.
  3. sqlite 행 삭제 + review queue에서 해당 id 포함 pair 제거(removeSampleFacts 패턴 재사용).
- API: `store.purge(ids, {source})`. 헬퍼 `purgeByProvenance(store, predicate)` — 예: provenance.source==="capture" && session_id 일치.
- rebuild 계약: 스크럽+tombstone 후 rebuild 왕복에서 대상 fact 부활 0, events 디렉토리 전체 grep에서 원문 claim 잔존 0.
- CLI: `nautli purge <fact_id...> --yes` (--yes 없으면 대상 목록만 출력하고 중단).

### 1.2.1 Redaction 한계 (정직 표기, 리뷰 2026-07-14 확정)
- base64/이중 인코딩된 시크릿은 v1이 못 잡는다(엔트로피 경계 하회 가능). 방어선은 redaction 단독이 아니라 [redaction → pending 후보 → **사람 승인 게이트**] 3중이며, redaction은 best-effort 1선이다. 문서·UI 카피 모두 "자동으로 가려요"가 아니라 "흔한 시크릿 패턴을 가려요"로.
- 패턴은 대소문자·공백/개행 분절·따옴표 값 전체를 커버해야 한다(우회 픽스처 테스트 고정).

### 1.4.1 purge 크래시 안전성 (리뷰 확정)
- purge는 다단계라 중간 크래시 시 원문이 잔존할 수 있다 → **purge 저널**: 실행 전 `~/.nautli/purge-journal.json`에 {ids, at} 기록 → [tombstone append → events 스크럽 → sqlite 삭제 → queue 정리] → 저널 삭제. Store 오픈 시 저널이 남아 있으면 같은 ids로 purge 단계를 멱등 재실행(자가치유 — .index-dirty 패턴과 동형).
- rebuild의 tombstone 처리는 시간순 재생으로만(영구 id 억제 셋 금지 — 재생 순서가 진실).

### 1.3.1 spool 가드 (리뷰 확정)
- 엔트리 키 화이트리스트(session_id, transcript_path, project, at, kind)+필드 4KB·엔트리 16KB 캡+스풀 총량 캡(초과=에러). 위반은 저장 전 거부(관례가 아니라 코드 가드). spool 디렉토리가 symlink면 거부.

### 1.5 비스코프 (005에서)
- 훅 설치·transcript 파싱·후보 생성(→006), 대시보드 UI(→006에서 필요분만), 암호화 저장(v2 — v1은 파일 퍼미션+로컬 한정).

## §2 shadow 캡처 (TASK-006 — 개요만, 구현 시 상세화)
Stop 훅(관리 매처 병합) → capture-hook 프로세스: opt-in 프로젝트인지 확인 후 spool에 {session_id, transcript_path(권위값), at}만 적재, 즉시 종료 → drain(수동 `nautli capture drain` + nightly): checkpoint(realpath+dev/ino+completeByteOffset+tailHash) 기준 delta 파싱(완결 newline만), 하네스 잡음 제외, redaction, pending 후보 생성(자동 활성화 금지). size 안정 2회 확인.

## §3 계측 (TASK-007 — 개요만)
후보 승인율·오탐률·검토시간·유용 회상률을 junk 홀드아웃(ivan/troll) 볼트 형식으로. 미달 시 자동 캡처 킬까지 성공 조건.

## §1 성공 기준 (착수 앵커)
1. redaction 픽스처 leak 0 + 산문 무변경 (25)
2. purge 후 rebuild 왕복 부활 0 + events 전체 grep 원문 잔존 0 + review queue 정리 (30)
3. spool 퍼미션 실측(0700/0600) + 원자쓰기 (15)
4. consent 게이트: opt-in 없으면 캡처 경로 skip(테스트로 고정) + CLI 3커맨드 (20)
5. 기존 테스트 74/74 유지 (10)
