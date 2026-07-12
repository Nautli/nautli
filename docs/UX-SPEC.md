# Glymph 차체 UX 스펙 v1 (2026-07-12 밤샘 빌드)

> 목표: 신규 유저가 마케팅 없이 제품만으로 "설치→AI 연결→습관 심기→데몬→아침 카드"를 완주.
> 진입점 = 로컬 대시보드. 마케팅(랜딩·영상) 스코프 제외.

## 유저 스토리 (완주 시나리오)
1. `git clone … && npm install && npm link` (배포 전) / 배포 후 `npm i -g glymph`
2. `glymph dashboard` → 브라우저 http://127.0.0.1:4600 자동 오픈
3. Setup 탭(첫 방문 자동): 체크리스트 5개를 버튼으로 완료
4. 다음날 아침: Review 탭 배지 → 카드 O/X 클릭
5. 평소: AI가 remember/recall (유저 무개입), 가끔 Memory 탭에서 검색

## 화면 1: Setup (미완료 항목 있으면 기본 탭)
체크리스트 항목 = 상태아이콘(✓완료/○미완/!오류) + 제목 + 설명 1줄 + 액션 버튼:
| # | 항목 | 상태 판정 | 버튼 → 동작 |
|---|---|---|---|
| 1 | 저장소 초기화 | `~/.glymph/index.sqlite` 존재 | [초기화] → POST /api/setup/init |
| 2 | Claude Code 연결 | `claude` CLI 존재 + `claude mcp list`에 glymph | [자동 등록] → claude mcp add 실행. 실패 시 수동 명령 코드블록+[복사] |
| 3 | AI 습관 지시문 | `~/.claude/CLAUDE.md`에 마커(`<!-- glymph:instructions -->`) 존재 | [CLAUDE.md에 설치] / [지시문 복사] |
| 4 | 밤 소화 데몬 (03:30) | `launchctl list`에 com.bug.glymph-daemon(추후 com.glymph.daemon) | [데몬 설치] → plist 생성+bootstrap / [지금 1회 실행] → daemon-run 백그라운드+결과 표시 |
| 5 | 다른 AI 도구 연결 (옵션) | — | [Cursor 설정 복사] (mcp.json 스니펫) |
| 6 | 기존 노트 이식 (옵션) | — | "준비 중" 배지 (v0.2) — 정직 표기 |
- 모든 버튼: 실행 중 스피너 → 결과 토스트(성공 초록/실패는 이유 문장) → 상태 재조회
- 전부 ✓면 상단에 "설치 완료 — 이제 AI가 알아서 기억합니다" 배너

## 화면 2: Review (아침 카드) — SPEC §9 카드 규칙 준수
- 데이터: `~/.glymph/review/queue.jsonl` status=pending
- 카드 구성(위→아래): 유형 배지(중복 정리|모순 발견) + 판정 confidence + **사람언어 한 줄**("이 두 기억이 같은 내용 같아요. 하나로 합칠까요?") + 기억 A/B 원문 (각각 scope·subject·t_valid 병기) + judge 근거(reason, 접힘)
- 버튼(카드 유형별):
  - 중복: [합치기] [따로 유지] [모름/나중에]
  - 모순: [새 기억이 맞음] [옛 기억이 맞음] [둘 다 유효함] [기타…(텍스트 입력)]
- **위험색 idle 금지**: 모든 버튼 평상시 중립색, hover/선택 시만 강조색
- 처리(비파괴, non-lossy):
  - 중복 합치기 = 오래된 쪽 transition(superseded) / 따로 유지 = 큐 항목 status:"dismissed"(기억 무변경) / 모름 = status:"deferred"(내일 다시)
  - 모순: 새것맞음 = 옛것 invalidated / 옛것맞음 = 새것 invalidated / 둘다유효 = 무변경+dismissed
  - **기타 텍스트 = 정정 루프**: 입력 문장을 remember(scope 동일, confidence 0.9, source:"review-card")로 새 fact 저장 + 큐 항목 status:"answered"
- 빈 상태: "검토할 카드가 없어요. 다음 소화는 오늘 새벽 3:30." / 에러 상태: 파일 깨짐 시 원인+doctor 안내
- 오라클 라우팅(v0 표기): 카드 하단에 "이 판단이 레포/코드로 확인 가능한 내용이면 '모름'을 눌러도 됩니다 — 다음 소화 때 자동 재판정" 힌트 문구

## 화면 3: Memory (기억 브라우저)
- 상단: 검색창(FTS) + scope 드롭다운(전체/개인/프로젝트별) + [죽은 기억 포함] 토글(기본 off=active만)
- 리스트 행: claim + 배지(scope, t_valid, confidence, status — superseded/invalidated는 회색+취소선 아님, 도장 아이콘)
- 행 클릭 → 상세 패널: 전체 필드 + 이력(대체됨→by 링크)
- 상단 [기억 추가] 입력창: 문장+scope 선택 → remember (게이트 거부 시 이유 토스트 — E_DUPLICATE 등 사람말 번역)

## 화면 4: Stats
- 카드 4개: 총 기억 수 / 상태 분포(active·superseded·invalidated) / 스코프별 top / 마지막 소화(시각+적용·큐 수)
- 리포트 목록(reports/*.md) → 클릭 뷰어(렌더된 md)

## 공통
- 네비: Setup / Review(＋pending 배지) / Memory / Stats. 헤더 우측: 데몬 헬스 점(초록=24h 내 exit0)
- 브랜드 표기 = src/brand.js BRAND 상수 (개명 시 1곳)
- 서버: `glymph dashboard [--port 4600] [--no-open]` — node 내장 http, **127.0.0.1 고정 바인딩**, 외부 의존성 0, 단일 HTML(인라인 CSS/JS)+/api/* JSON
- 보안: POST만 상태 변경, Origin 헤더가 127.0.0.1이 아니면 403, 셸 실행은 화이트리스트 커맨드만(claude mcp add/launchctl/…), 토큰·시크릿 로그 금지
- CLI 미러: `glymph setup`(대화형 5단계, 대시보드와 동일 로직 공유), `glymph review`(터미널 O/X), doctor 보강(node 버전·claude CLI·데몬 상태)

## v1.1 확정 변경 (sol UX 크리틱 → 디렉터 수용/기각, 2026-07-12)
**수용:**
1. **첫날 가치 경험(최중요)**: Setup 마지막 단계 = "체험 소화" — 샘플 기억 2쌍(source:"sample", 삭제 가능) 저장 → 즉시 소화 1회 → 샘플 카드가 Review에 뜸 → 첫 O/X를 설치 5분 안에 경험. 완료 후 [샘플 지우기] 버튼
2. Setup을 **필수 4개**(저장소/Claude연결/지시문/데몬)+선택 섹션으로 분리 — 완료 배너는 필수만 판정. "노트 이식 준비중" 항목 삭제
3. 데몬 신뢰: 상태 판정 = plist 존재+최근 health.log exit=0 조합. 마지막 실행 24h+ 경과 시 경고+[지금 소화 테스트]. "다음 실행" 시각을 정확 계산해 표시. Setup에서 1회 실행 성공이 완료 조건
4. CLAUDE.md 수정 전 **추가될 블록 diff 미리보기 모달** + 마커 기반이라 [지시문 제거] 역방향 제공. 데몬도 uninstall 커맨드 제공
5. 동시성 최소 방어: 카드 처리는 pair_id 기반 멱등(이미 non-pending이면 no-op), queue 재작성은 tmp+atomic rename
6. Origin allowlist 명확화: `http://127.0.0.1:<port>`, `http://localhost:<port>` exact만 허용, 상태 변경은 POST만
7. 카피 교체: [기억 저장소 만들기] / [Claude Code 지시문 추가] / [지금 소화 테스트] / [내일 다시 보기] / 완료 배너 "연결 완료 — 대화 중 필요한 기억을 저장할 수 있어요"
8. 오라클 재판정 힌트 문구 삭제(미구현 기능 거짓 기대 금지)
**기각(사유):** Stats 전체 삭제(→카드 4개로 축소 유지: 데몬 신뢰 표면이라 필요) / Memory 수동 추가 삭제(→유지: 정정 루프와 동일 코드 경로+게이트 거부 데모 가치) / CSRF 토큰(→v0는 로컬 단일유저+Origin 체크로 충분, v0.2)
**리포트 md 뷰어 삭제 수용** — Stats에 마지막 소화 요약 숫자만.

## 성공 기준 (착수 시 앵커 — 채점 루브릭)
1. 격리 홈(GLYMPH_HOME) 신규유저 e2e: setup→remember→daemon-run→카드 발생→대시보드에서 O/X→저장소 반영까지 실측 왕복 (30점)
2. Setup 5항목 버튼이 실제 동작+실패 시 사람말 사유 (20점)
3. 카드 규칙 준수: 사람언어 번역·출처날짜·위험색 idle 금지·정정 루프 (20점)
4. 기존 테스트 21/21 유지 + 신규 로직 테스트 추가 (10점)
5. 비주얼 QA: 빈/정상/에러 상태 매트릭스 스크린샷 결함 0 (10점)
6. 보안: 127.0.0.1 고정·Origin 체크·화이트리스트 셸 (10점)
