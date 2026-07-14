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

## §2 shadow 캡처 (TASK-006 — 2026-07-14 상세 확정)

### 2.1 훅 설치 `src/capture/hooks.js`
- CLI: `nautli capture hooks install|uninstall|status`. 대상 `~/.claude/settings.json`의 `hooks.Stop`.
- 관리 커맨드 = `"<node절대경로> <cli.js절대경로> capture-hook"` (공백 경로 따옴표). 식별 매처 = 커맨드 문자열에 `capture-hook` 포함 — **자기 항목만** 교체/제거, 유저 수기 훅 보존(Orca installer-utils 패턴), tmp+rename+.bak 1세대, 내용 동일 시 무변경.
- 삭제 내성: nautli가 지워져도 훅 커맨드는 실패해도 Claude를 막지 않는다(Stop 훅 실패 비치명). uninstall이 정식 경로.

### 2.2 capture-hook (CLI 서브커맨드, 초경량)
- stdin으로 Claude 훅 페이로드 JSON 수신 → `{session_id, transcript_path, cwd}` 추출.
- cwd가 opt-in 프로젝트(§1.1, realpath) 아니면 **조용히 exit 0** (아무것도 안 읽음/안 씀).
- opt-in이면 spool 엔트리 `{session_id, transcript_path, project, at, kind:"stop"}` 기록(§1.3 가드 통과) 후 즉시 exit 0.
- 어떤 에러도 exit 0 (stderr에만) — 훅이 Claude 사용을 방해하면 안 된다. transcript 파일은 이 단계에서 열지 않는다.

### 2.3 checkpoint `~/.nautli/capture/checkpoints.json`
- key = realpath(transcript_path). value = `{dev, ino, offset, tail_hash, updated_at}`.
- offset = **완결 newline까지의 byte** 오프셋. tail_hash = 마지막 완결 라인의 sha256 앞 16자.
- 불일치 감지(파일 교체/truncate/로테이트): size < offset, dev/ino 변경, offset 직전 라인의 해시 ≠ tail_hash → offset 0부터 재파싱(후보 중복은 2.6 게이트가 거름).
- 원자쓰기. 훅은 힌트, checkpoint가 진실원 — spool이 유실돼도 다음 drain이 checkpoint 이후 delta를 처리.

### 2.4 drain `nautli capture drain [--dry]` + nightly
- 진입: spool 엔트리 전부 + (spool에 없어도) checkpoint에 등록된 transcript 중 mtime 갱신분.
- transcript는 opt-in 프로젝트 소속 + realpath가 `~/.claude/projects/` 하위인지 검증(밖이면 skip+경고).
- size 안정 확인: stat 2회(간격 ≥500ms) 동일 size일 때만 진행. 불안정하면 이번 회차 skip(spool 유지).
- delta 읽기: offset부터 마지막 완결 `\n`까지만. 부분 라인은 다음 회차로.
- 라인 파싱: JSON 라인 중 user/assistant 메시지만. 제외: `isMeta`, tool_use/tool_result 원문, **하네스 잡음**(user turn 내용이 `<system-reminder>`·`[SYSTEM NOTIFICATION`·`<task-notification>`·`<command-name>`로 시작/구성). 파싱 불가 라인은 카운트만 하고 skip(silent drop 금지 — drain 결과에 malformed 수 보고).
- delta 텍스트(발화자 라벨 포함)를 **redaction(§1.2) 통과 후** 추출기로. redaction 이전 원문은 어디에도 저장 금지.
- 실패(추출기 에러 등) 시 spool 엔트리 유지+retry 카운트, 3회 초과 시 `dead:true` 마킹(결과에 보고). 성공 시 spool 엔트리 제거+checkpoint 전진.

### 2.5 추출기
- config `judge_cmd` 재사용(기본 claude CLI 헤드리스, daemon pipeline 스폰 패턴). 입력: redacted delta(최대 24KB, 초과 시 뒤쪽 우선 잘라냄+보고). 출력 계약: JSON 배열 0~5개 `[{claim, scope, confidence}]` — claim은 자립형 한 문장, scope는 `project:<이름>`|`person`|`procedure` 제안.
- 출력 파싱 실패 = 추출 실패(재시도 대상). --dry는 추출기 호출 없이 delta 통계만.

### 2.6 후보 적재 (자동 활성화 금지)
- review queue에 `type:"capture"` 카드: `{pair_id:"cap:<hash>", claim, scope, confidence, session_id, project, at, status:"pending"}`.
- 중복 게이트: 동일 claim_hash의 pending capture 카드 존재 시 skip, 이미 active fact와 동일 claim_hash면 skip (**duplicate 0 게이트**).
- 승인 시에만 remember 게이트 경유 저장, provenance `{source:"capture", session_id, project}` → `purgeByProvenance`로 세션/프로젝트 단위 완전삭제 가능.
- 대시보드 카드 탭: capture 카드 렌더(배지 "대화에서 발견", 버튼 [기억하기] [버리기] [나중에] — 기존 카드 프레임 재사용, 위험색 idle 금지).
- nightly(daemon pipeline) 마지막에 drain 1회 포함.

### 2.7 게이트 (성공 기준)
1. 격리 e2e(모의 transcript jsonl + 모의 추출기): 훅 설치→capture-hook(opt-in/미동의 분기)→drain→pending 카드 생성→승인 시에만 fact, **자동 활성화 0** (30)
2. secret fixture가 든 모의 transcript → 후보 claim·spool·checkpoint·큐 어디에도 원문 잔존 0 (25)
3. duplicate 0: 같은 delta 2회 drain(checkpoint 리셋 포함) 시 pending 카드 1개 (15)
4. checkpoint: 부분 라인 이월·truncate 재시작·tail_hash 불일치 재시작 (15)
5. 훅 병합: 유저 수기 Stop 훅 보존+재설치 멱등+uninstall 완전 제거 (10)
6. 기존 테스트 84/84 유지 (5)

## §3 계측 (TASK-007 — 개요만)
후보 승인율·오탐률·검토시간·유용 회상률을 junk 홀드아웃(ivan/troll) 볼트 형식으로. 미달 시 자동 캡처 킬까지 성공 조건.

## §1 성공 기준 (착수 앵커)
1. redaction 픽스처 leak 0 + 산문 무변경 (25)
2. purge 후 rebuild 왕복 부활 0 + events 전체 grep 원문 잔존 0 + review queue 정리 (30)
3. spool 퍼미션 실측(0700/0600) + 원자쓰기 (15)
4. consent 게이트: opt-in 없으면 캡처 경로 skip(테스트로 고정) + CLI 3커맨드 (20)
5. 기존 테스트 74/74 유지 (10)
