# nautli

모든 AI가 공유하는 하나의 뇌. Claude Code, Cursor 등 여러 AI 도구가 하나의 로컬 기억을 같이 쓰고, 자는 동안 소화 데몬이 중복을 합치고 모순을 정리합니다. 정본은 서버가 아니라 당신 디스크의 파일입니다.

- 기억은 fact 단위로 쌓이고, 애매한 정리는 자동 실행 대신 리뷰 카드로 사람에게 물어봅니다.
- 서드파티 서버 없음. LLM 판정(중복·모순)만 본인 Claude 구독(claude CLI)을 거쳐 처리됩니다.
- 스펙 정본: [SPEC.md](SPEC.md)

## 시작하기

요구사항: Node.js 20+, [Claude Code CLI](https://claude.com/claude-code) 로그인 상태. (better-sqlite3는 네이티브 모듈이라 대부분 플랫폼은 prebuilt 바이너리를 받고, 없는 조합이면 설치 중 python3 + 빌드 툴체인으로 컴파일합니다.)

```bash
npx nautli dashboard
```

`dashboard`가 설정 화면을 엽니다(127.0.0.1 전용). 화면이 나머지를 안내합니다:

1. **내 기억 건강검진**: 이미 쓰고 있는 옵시디언 볼트나 CLAUDE.md를 스캔해서 중복·모순·낡은 기억을 점수와 리포트로 보여줍니다. 맛보기는 노트 40개, 10분 안팎. 마음에 들면 추출된 기억을 한 번에 가져올 수 있습니다.
2. **Claude Code 연결**: MCP 등록(remember / recall / briefing 툴).
3. **AI 습관 지시문**: Claude가 기억 도구를 실제로 쓰도록 CLAUDE.md에 지시문 한 블록 추가.
4. **밤 소화 데몬**: 매일 밤 3:30, 중복 병합과 모순 카드화. 언제든 제거 버튼으로 되돌릴 수 있습니다.

전역 설치를 원하면:

```bash
npm i -g nautli
nautli dashboard
```

소스에서 직접 실행하려면 (기여자용):

```bash
git clone https://github.com/nautli/nautli.git && cd nautli
npm install
node src/cli.js dashboard
```

## AI에게 설치 시키기

Claude Code 같은 코딩 에이전트에게 이 블록을 그대로 주면 사람 개입 없이 끝납니다(전 과정 비대화형):

```bash
npx nautli setup --yes    # 저장소 초기화 + MCP 등록 + 지시문 + 밤 데몬 + 소화 1회
npx nautli doctor         # 설치 상태 점검
```

`setup --yes`는 위 대시보드 4단계를 한 번에 실행합니다. 단계별로 하려면 `--step init|mcp|instructions|daemon|digest`.

## CLI로 쓰기

```bash
npx nautli init                                          # ~/.nautli 생성
npx nautli remember "우리 API 포트는 4000이다" --scope project:myapp
npx nautli recall "포트" --scope project:myapp
npx nautli daemon-run                                    # 소화 1회 수동 실행
npx nautli rebuild                                       # 정본(events/*.jsonl)에서 인덱스 재구성
```

MCP 수동 등록:

```bash
claude mcp add -s user nautli -- npx nautli mcp
```

## 데이터 경계

- 기억·이벤트 로그·리포트 전부 `~/.nautli/` 로컬 파일. 어떤 원격 서버에도 업로드하지 않습니다.
- 건강검진과 밤 소화의 LLM 판정 텍스트만 본인 Claude 구독을 거쳐 Anthropic에서 처리됩니다.
- fact는 DELETE하지 않습니다(soft archive). `rebuild`로 정본 파일에서 언제든 복원됩니다.

## 구조 (SPEC §1)

`src/core` 저장·게이트·recall / `src/mcp` stdio 서버 / `src/cli.js` / `src/daemon` pair, judge, apply, report, render / `src/dashboard` 로컬 대시보드 / `src/onboard` 설정·건강검진

## 불변식 (위반은 버그, 테스트로 고정)

정본은 유저 파일(rebuild 왕복) / facts DELETE 금지 / 쓰기 단일패스, 정리는 데몬만 / 데몬이 죽어도 코어 동작 / recall에 프로모션 주입 금지 / 애매하면 no-op(오병합 비대칭)

## 알려진 한계 (v0.3)

- t_valid가 날짜 단위라 같은 날 모순은 recorded 시각과 문맥으로 판정(judge에 위임)
- judge LLM 비결정성: 격리 cwd, 포맷 예시, 0파싱 재시도, 실패 배치 no-op의 4중 방어
- 임베딩 미탑재(FTS 프리픽스만), v1.1 예약
- 중복 병합 방향이 t_valid 기준이라 부분집합이 최신이면 상위집합이 접힐 위험. v0.2 백로그에서 judge keep 필드로 교체 예정

## v0.2+ 백로그

judge keep 필드(병합 방향) / 스코프 통째 망각 / 정정 루프(리뷰카드 답변이 새 fact 생성) / 트랜스크립트 재처리 / verdict enum 확장(keep·update·delete·insert_new) / judge 이중검증(무LLM 휴리스틱 교차) / `nautli restore <id>` / briefing keep_first 앵커 층 / 벌크 임포트 한정 cheap dedup 전단필터(소화 데몬 경로는 실측 기각: judge행 중복쌍의 sim 중앙값 0.57이라 효과 없음)
