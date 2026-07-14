# 온보딩 강화 v1.5 최종 스펙 (2026-07-14 확정)

> 초안: onboarding-v15-draft.md (Orca 구조 번안). 3자 토론 통합본 — 디렉터 수용/기각 명시.
> 크리틱: SV UX 전문가 + 타겟 유저(회의적 3년차, 프라이버시 민감) 독립 2관점.

## 디렉터 판정 요약

**수용 (스펙에 반영됨):**
1. [유저] **스캔은 옵트인** — 세션 스토어 통계는 유저가 버튼을 눌러야 시작. CLI 감지(PATH 바이너리 확인)만 자동(파일 안 읽음).
2. [유저+전문가] **프라이버시 카피 = 구현 사실과 일치** — jsonl 라인 읽기 전면 삭제(시간 추정 폐기). 스캔은 파일 목록+수정시각(mtime)만. 카피 "파일 목록과 수정 시각만 읽어요. 내용은 열지 않아요. 네트워크 요청 0회." 가 기술적으로 100% 참이 되게.
3. [전문가] **hours30d 삭제** — 방치 세션 왜곡으로 거짓 숫자 위험. sessions30d(개수)만. hours는 v2(정확도 검증 후).
4. [유저] **Codex 연결 정식 스코프 인** — `codex mcp add` 실증 확인(codex-cli 0.144). 감지해놓고 연결 못 하면 감지가 배신이 됨. Claude와 동일 패턴(등록+상태판정+수동 명령 폴백).
5. [전문가] **히어로 1개 원칙** — 감지 카드 박스 별도 신설 금지. 스텝퍼 헤드라인에 숫자 인라인, 에이전트 상태칩은 해당 스텝 행에 병기.
6. [전문가] **상실→기회 프레임** — "오늘부터 바꿔요" 삭제. remembered=0이면 "다음 대화부터는 여기 남아요". remembered>0이면 "{S}세션 중 {N}개 기억됨"(자기효능). sessions30d<10이면 숫자 강조 생략(중립 카피).
7. [전문가+유저] **star 트리거 이연** — 연속성 성공 직후(자기가 넣은 걸 되읽은 것, 가치 증명 전) 금지. 트리거 = 첫 리뷰 카드 처리 완료 시(진짜 가치 순간). 평생 1회, 실패 화면 금지 유지. 체크리스트 star 행 삭제(종결 조건 볼모 금지).
8. [전문가] [연결] 버튼은 저장소 미초기화 시 init 묵시 선행(원버튼).
9. [전문가] 스캔 실패 시 quiet "다시 감지" 링크(콘솔 유일 금지).

**기각 (사유):**
- [유저] 검진을 더 앞으로: 기각 — 유저 본인도 "첫 5분엔 안 돌림". 현행(선택 섹션) 유지.
- [전문가] star 토스트 자체 회의론: 기각 — 트리거 이연으로 해소, 노출 규칙 엄격 유지.

---

## A. 감지 + 옵트인 사용량 (Setup 헤더 인라인)

**1단계: 에이전트 감지 (자동, 파일 미접촉)**
- `src/onboard/scan.js` 신규: `detectAgents()` — PATH에서 claude/codex/cursor/gemini `--version` (execFile, 각 2s 타임아웃, 실패=미설치). 연결 상태: claude=`claude mcp list`에 nautli(기존 로직 재사용), codex=`codex mcp list`에 nautli, cursor=기존 스니펫 상태, gemini=감지만.
- Setup 히어로 서브라인에 인라인: "감지된 AI {N}개 · {이름들}" (박스 카드 아님).

**2단계: 사용량 스캔 (옵트인)**
- 히어로 아래 quiet 버튼 1개: [내 AI 사용량 확인하기] + 마이크로카피 "로컬에서만 · 파일 목록과 수정 시각만 · 네트워크 요청 0회"
- 클릭 → `POST /api/scan` → `scanUsage()`: `~/.claude/projects/**/*.jsonl`, `~/.codex/sessions/**/*.jsonl` — **readdir+stat만, 파일 open 금지.** 30일 필터=mtime. 파일 3,000개 캡(초과 "3,000+"), 총 예산 5s 초과 시 partial.
- 결과 인라인 교체(헤드라인 승격): "최근 30일 Claude {A}·Codex {B} 세션 · nautli에 기억된 건 {R}개"
  - R=0: 서브 "다음 대화부터는 여기 남아요."
  - R>0: 서브 "{S}세션에서 {R}개를 기억했어요."
  - 총 세션<10: 숫자 헤드라인 생략, "감지된 AI {N}개 · 연결하면 여기서부터 기억돼요."
- 캐시 `~/.nautli/scan.json` `{version:1, scanned_at, partial, agents[], usage:{claude_sessions30d, codex_sessions30d}|null, remembered}` — 옵트인 후에만 usage 기록, 24h TTL 내 재방문 시 자동 갱신 표시(최초 옵트인이 동의 기록: `usage_scan_opted_in_at` config 저장).
- `GET /api/scan` = 캐시+감지 반환(usage는 옵트인 전 null). 실패 시 UI에 quiet [다시 감지].

## B. 스텝 재편: Codex 연결 추가

- 필수 스텝은 4개 유지하되 스텝2를 "AI 연결"로 일반화: 행 2개 — Claude Code(기존), **Codex(신규)**.
  - 완료 판정: 필수 = **둘 중 하나 이상 연결**(둘 다 미설치 유저 배제 금지). 감지된 것만 행 노출(둘 다 미설치면 기존 Claude 행+설치 안내).
  - Codex [자동 등록] = `codex mcp add nautli -- <node> <cli.js> mcp` (setup.js에 registerMcpCodex — ALLOWED_COMMANDS에 codex 추가, 실패 시 수동 명령 코드블록+복사, Claude와 동일 에러 패턴 E_CODEX_CLI_MISSING/E_MCP_REGISTER_FAILED).
  - status.required.mcp → `{claude:{...}, codex:{...}, complete: claude.registered||codex.registered}` (API 하위호환: 기존 필드 유지+확장).
- 연결 행에 상태칩: 연결됨(초록)/설치됨(중립)/미설치(회색+설치 링크 없음, 정직).
- 지시문 스텝은 현행(CLAUDE.md) 유지. codex AGENTS.md 지시문은 v2 — 행에 과장 금지(연결=recall/remember 도구 사용 가능, 습관 지시문은 Claude만이라고 툴팁 정직 표기).

## C. 상주 체크리스트 "다음 할 일" (필수 완료 후)

- 필수 완료 시 스텝퍼가 체크리스트 모드로 전환, 진행도 {done}/{total}:
  1. 첫 진짜 기억 (기존 연속성, 완료/건너뜀 상태 그대로)
  2. 내 기억 건강검진 (기존, done/dismissed 반영)
  3. 두 번째 AI 연결 (Claude+Codex 중 하나만 연결 시 나머지 이름 명시. 둘 다면 Cursor 스니펫)
  4. 공유 카드 만들기 (기존 진입점 흡수)
- 행 = 상태아이콘+제목+1줄+버튼 1개. 미완 첫 행만 primary(주황 1개 원칙).
- 전부 완료/건너뜀 → 종결 배너 "다 됐어요. 이제 nautli는 알아서 굴러가요" + 체크리스트 접힘(quiet [다시 보기]로 재열람 — 재방문 시에도 접힘 유지, localStorage 아닌 서버 파생 상태로 판정).

## D. star 토스트

- 트리거: **첫 리뷰 카드 처리 액션 성공 직후**(어느 버튼이든). 토스트: "첫 카드 처리 완료. nautli가 쓸만하면 별 하나 주세요" [GitHub 열기] [나중에]
- 평생 1회: config `star_nag_shown_at` (서버 저장, POST /api/star-nag-seen). 에러 토스트와 동시 노출 금지. 체크리스트에 star 행 없음.

## E. 잔손질

- Setup 위저드에서 Enter=현재 primary 버튼(전역 primary 1개 원칙이라 안전. input/textarea 포커스 시 제외).
- 검진 시작 모달 후보 감지는 기존 로직 유지(스캔 캐시와 무관 — 대상이 다름: 볼트 vs 세션 스토어).

## 비스코프

- hours 추정(v2), gemini/cursor 세션 통계, codex AGENTS.md 지시문(v2), 사이드바 신설, 자동 캡처, 테마, 폰.

## 데이터/에러/상태 (머신체크)

- scan.json 스키마 위 A절. 버전 불일치→재스캔. usage_scan_opted_in_at 없으면 usage 항상 null.
- 에러 enum: E_SCAN_TIMEOUT(partial 흡수), E_CODEX_CLI_MISSING, E_MCP_REGISTER_FAILED(재사용). 스캔 실패=heroes 중립 카피+quiet 재시도(블로커 금지).
- 상태머신: setup(필수 미완) → checklist(필수 완료·잔여 있음) → done(전부 완료/건너뜀·접힘). star_nag: never→shown(1회). 옵트인: none→opted(영구).
- API: GET /api/scan, POST /api/scan(옵트인+갱신), POST /api/setup/codex, POST /api/star-nag-seen. 기존 보안 규칙 전부 적용(127.0.0.1, Origin, Host, POST 상태변경).

## 성공 기준 (착수 앵커)

1. 격리 홈+모의 세션 파일(claude 12·codex 3, 30일 안팎 mtime 섞기)에서 scan API가 스키마대로, **파일 open 0회**(fs.open/readFile 스파이 테스트), 옵트인 전 usage null (25)
2. 신규유저 e2e: 감지 인라인→옵트인 스캔→숫자 헤드라인→Codex 등록(모의 runner)→필수 완료→체크리스트 전환→카드 처리→star 토스트 1회성 (25)
3. 기존 테스트 60/60 유지 + 신규(스캔 엣지: 빈 홈/3000캡/partial/옵트인 게이트, codex 등록 실패 폴백, star 1회) (20)
4. 비주얼 QA: 히어로 4상태(감지만/옵트인 전/숫자/저사용 중립)+체크리스트 2상태+star 토스트 — 겹침·잘림·상태누수 0, 히어로 박스 1개 원칙 (20)
5. 카피: 줄표 금지·프라이버시 문구가 구현 사실과 자구 일치·과장 금지 (10)
