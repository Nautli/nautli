# 건강검진 멀티소스(교차 진단) 스펙 (2026-07-15)

> 유저 확정 + sol(codex) 코드리뷰 반영. 목표: "폴더를 고르게 하지 말고, 버튼 하나로 내 AI 기억 전체를 검사"하되,
> 여러 AI 소스 **사이의** 모순(예: Claude엔 배포 금요일, Gemini엔 화요일)을 실제로 잡는다.

## 확정 UX
- 라디오/폴더선택을 기본 경로에서 제거. 주 CTA 1개: **[내 AI 기억 전체 검사]**.
- 기본 스윕 집합 = **AI 하네스 화이트리스트만**: `claude-harness`, `codex-harness`, `gemini-harness`.
- `shared-memory`(미러) = **기본 제외** — 자기복제 중복만 양산해 판정 캡을 잡아먹음(sol). "범위 조정"에서 opt-in.
- `obsidian`(개인 노트) = **기본 제외**, opt-in. `cursor-harness` 등 미래 kind도 기본 제외(화이트리스트 방식, `!==obsidian` 금지).
- "범위 조정" 접힌 영역에서 체크박스로 소스 추가/제외. 화면에 **소스별·전체 표본 파일 수 + 예상 시간** 명시.

## Phase 1 (지금 빌드) — 원클릭 + 실제 교차모순 검출
### vault_doctor.py (파일 정체성 모델 변경이 핵심)
1. `main()`: positional `vault` → `nargs="+"` (단일 호출 하위호환 유지). 각 root를 canonical(realpath)로 정규화, 중첩 root는 자식 제외.
2. 파일 정체성: 현재 `rel`(상대경로) 기반 → **`(source_id, rel)`**. `source_id = sha1(realpath(root))[:8]`.
   - manifest 각 파일 엔트리: `{source_id, source_label, root, rel, abs, size, date, scope}` (abs=열 절대경로).
   - `stage_extract`가 `os.path.join(ctx.vault, rel)` 대신 `f["abs"]`로 열기.
   - atom id: `"fa_"+sha1(source_id + rel + claim)` (현재 `claim+source`라 root 간 충돌 — vault_doctor.py:291).
   - atom에 `source_id`, `source_label` 보존.
3. 표본: `--max-files`를 **root별 독립 적용**(소스당 40). seed는 root별 `sha1(realpath(root))`로 고정 → 소스 추가해도 기존 표본 불변. 전체 표본 = Σ min(sourceFiles, 40).
4. **교차쌍 생성(가장 중요)**: 현재 `stage_pair`는 같은 `scope`끼리만 쌍 생성(vault_doctor.py:351-355) → 서로 다른 소스는 scope가 달라 **교차쌍이 아예 안 생김**. 2층 페어링:
   - Layer 1: 정규화 scope 같은 것끼리(기존 유지).
   - Layer 2: **서로 다른 source_id** 이면서 (subject 동일 OR 유사도 높음)인 쌍을 cross-source quota(예: max_judge_pairs의 40%)로 추가.
   - 자기복제 방어: 동일 claim 정규화 해시가 같으면 미러로 보고 쌍에서 제외(중복 건수에도 안 셈 — Phase 2에서 강화).
5. judge 입력에 `source_label`, `type` 추가(vault_doctor.py:407-410) → 서로 다른 대상/규범을 모순 오판 방지.
6. slug: 단일 경로 → **정렬된 canonical root 목록 + root별 exclude/cap** 해시(vault_doctor.py:604).
7. report/summary: 소스별 표본 수 + **교차소스 모순 건수**를 별도 표기.

### src/onboard/checkup.js + server.js
- `checkupPreflight`/`startCheckup`: `paths[]`(배열) 수용. 각 경로 `validateVaultPath`. 단일 `path`도 하위호환.
- `checkupCandidates`: 기존 kind 유지. 기본 스윕 분류 헬퍼 `DEFAULT_SWEEP_KINDS = new Set(["claude-harness","codex-harness","gemini-harness"])` 추가, `.slice(0,8)` **이전에** 분류 적용(큰 옵시디언이 하네스를 밀어내지 않게 — checkup.js:146).
- `/api/checkup/start`·`/preflight`: `input.paths`(배열) 우선, 없으면 `input.path` 단수 폴백.

### src/dashboard/public.js (i18n T())
- `openCheckupModal`: 라디오 목록 제거. 상단 주 CTA "내 AI 기억 전체 검사"(기본 스윕 kinds 자동 선택) + 소스별/전체 표본 수·예상시간 요약.
- "범위 조정" 접힘: 체크박스로 shared-memory/obsidian/cursor opt-in, 개별 하네스 제외.
- 새 문자열은 DASH_EN + T() 키로(영문 기본 + 한국어).

## Phase 2 (후속, 지금 안 함)
- 미러 지문 제거(콘텐츠 fingerprint + canonical atom 해시) 후 `shared-memory` 자동 포함.
- 규범(instruction/normative) vs 사실(memory/descriptive) 역할 분리 추출 — 규칙문서와 사건기억이 섞여 오탐 나는 것 방지. 규범↔사건 쌍은 모순 후보 제외.
- scope 의미 정규화(현재 최상위 폴더명 → subject/type 기반).

## 검증 게이트 (Phase 1 완료 조건)
- 픽스처 e2e: `claude-harness`에 "배포는 금요일", `gemini-harness`에 "배포는 화요일" 심고 원클릭 → **교차소스 모순 1건**이 리포트에 뜬다(단일 폴더 진단으론 안 나오던 것).
- 단일 경로 하위호환: 기존 `nautli checkup <path>` 1개 경로 여전히 동작.
- 유닛 회귀 그린.
