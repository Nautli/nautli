# 신뢰 주장 대장 (Trust Claims Ledger) v1

> TASK-101 · 2026-07-23 · 해자 논의 R2 후속. 외부(사이트·README·대시보드·i18n)에 노출 중인 정량·보안·신뢰 주장 전수와, 각 주장의 ①근거 artifact ②측정 시점·유효 조건 ③만료·재측정 주기 ④철회 조건.
> 운영 규칙: **새 외부 주장은 이 대장에 행이 먼저 생기고 나서 카피에 실린다.** 철회 조건이 관측되면 카피를 내리는 게 먼저, 대장 갱신이 다음. 사고 시 절차는 [INCIDENT-PROTOCOL.md](INCIDENT-PROTOCOL.md).

## A. 정량 주장

| # | 주장 (노출 위치) | 근거 artifact | 측정 시점·유효 조건 | 만료·재측정 | 철회 조건 |
|---|---|---|---|---|---|
| A1 | 메모리 토큰 ~95% 절감 (site hero·FAQ, i18n en/ja/ko) | 2026-07-17 Evanwiki 606노트 실측: 상시로딩 ~22,000tok/세션 vs recall 평균 570tok/질문. 커밋 `16ea721`(scan report measured token hero). 절감 영수증 기능은 유저별 실측치 사용 | 대형 볼트(수백 노트)의 "전체 상시로딩" baseline 대비. 소형 볼트엔 축소 명시 필요 | SessionStart 인덱스 등 로딩 구조 변경 시 재측정 | recall 평균 토큰이 baseline의 10%를 넘는 실측이 나오면 수치 하향 |
| A2 | "모순 노트 49쌍 — 함께 들어가면 동전 던지기" (site FAQ) | 동일 2026-07-17 Evanwiki 검진 리포트 | 해당 볼트 1개의 실측 사례 서술(일반화 주장 아님 — 카피가 사례임을 유지해야 함) | 검진 로직 변경 시 재확인 | 사례 서술을 일반 수치처럼 쓰는 카피 변형 발견 시 원상복구 |
| A3 | 오병합 0/24 — "0 observed, not impossible" (README:73) | 홀드아웃 3볼트 결과(`bug4city/onebrain-vault-holdout` results/, 허브 2026-07-13 기록). rule of three: 95% 상한 ~12% | 표본 24, 외부 볼트 3개. "확정 통과" 아님 — 관측 서술만 허용 | 자동병합 표본 누적 시 갱신(ivan duplicate 304건 재라벨이 최저비용 확대 경로) | 오병합 1건 발견 즉시 수치 철회+INCIDENT 발동. **⚠️ 정책 충돌 미해결**: 2026-07-16 sol 크리틱 합의는 "0/24는 표본 작아 외부 카피 금지(내부 게이트 전용)"인데 README에 노출 중 — README에서 내리든가 합의를 갱신하든가 유저 결정 필요 |
| A4 | 모순 탐지 재현율 100% (labeled set) (README:74) | `~/Desktop/glymph-poc/RESULTS.md` (자체 446파일 labeled set) | 자체 데이터 한정 — README가 "labeled set" 한정을 이미 명시 | labeled set 확장(외부 볼트 라벨) 시 재측정 | 외부 볼트 재현율 <100% 실측 시 수치 교체 |
| A5 | junk 필터 약점 공개: 자체 한 자릿수, 외부 볼트는 더 나쁨(57~63%) (README:76) | 홀드아웃 ivan 63%·troll 57% (허브 2026-07-13) | 음성 결과 자발 공개(신뢰 자산) — 유지 | junk v3 판정전 결과로 갱신 | 해당 없음(불리한 공개는 내릴 이유 없음) |

## B. 프라이버시·보안 주장

| # | 주장 (노출 위치) | 근거 artifact | 유효 조건 | 만료·재측정 | 철회 조건 |
|---|---|---|---|---|---|
| B1 | 노트는 nautli 서버로 안 감 / 업로드 없음 / "우리 서버 자체가 없음" (README:80, site trustLine 3개 로케일) | 아키텍처: 저장은 전부 `~/.nautli` 로컬 파일. 외부 egress allowlist는 `scripts/check-network-allowlist.js`로 검사 | "서버 없음"은 *컨텐츠 서버* 없음의 의미이며 **zero egress를 뜻하지 않는다**. 허용된 외부 전송은 정확히 세 가지: `telemetry.nautli.ai`의 judgment-meta, `nautli.ai/api/ping`의 익명 집계, `nautli.ai/api/share`의 사용자 클릭으로만 발생하는 집계+최대 20자 nick. 카피가 이 구분을 흐리면 안 됨. 정적 allowlist 가드는 회귀 방지용이며 난독화 우회까지 막는 보안 샌드박스가 아님 — 우회 패턴 발견 시 가드에 추가한다. | 네트워크 경로 추가되는 릴리스마다 `check:network` 재확인 | 노트/claim 본문이 외부로 나가는 코드 경로가 하나라도 생기면 즉시 카피 철회+INCIDENT |
| B2 | 판정 메타만 전송, 내용 미전송 / 익명 집계 숫자 7개 (strings.js:90,50, site) | `src/daemon/telemetry.js` payload enum(route/resolver/user_action 카운트) — 자유 텍스트 필드 없음. 홀드아웃 킷 무개입 완주가 실전 리허설(허브 2026-07-11) | payload 스키마가 지금 형태일 때만 참 | payload 필드 추가 시 카피 갱신 선행 필수 | 텍스트 필드가 payload에 들어가는 순간 "숫자 7개" 카피 거짓 |
| B3 | 텔레메트리 기본 OFF (site ko:377) | `src/daemon/telemetry.js:124` — `config?.telemetry?.enabled === true`만 활성(opt-in) | — | 기본값 바꾸는 결정 자체가 TASK-055 쟁점 — 바뀌면 카피 선행 수정 | 기본 on 전환 시 이 카피는 즉시 거짓 |
| B4 | 원본 노트 수정 없음 / scan은 읽기전용 (trustLine, site, diagnose) | `test/trust-guards.test.js` — scan/checkup 전후 볼트 트리의 해시·크기·mode·mtime을 비교 | — | scan/checkup 경로 변경 시 해당 테스트 재실행 | 원본 파일 mtime 변경이 스캔 중 관측되면 즉시 철회 |
| B5 | 안전 불변식: facts DELETE 금지·애매하면 no-op (README.ko:80) | `test/invariants.test.js` + purge는 명시 유저 요청 경로만 | "DELETE 금지"는 *자동 파이프라인* 한정(purge 실존) — 카피가 한정을 유지해야 함 | 릴리스마다 invariants 테스트가 CI에서 돌면 충족 | invariants 테스트 삭제·스킵 시 |

## C. 이식·라이선스 주장

| # | 주장 (노출 위치) | 근거 artifact | 유효 조건 | 만료·재측정 | 철회 조건 |
|---|---|---|---|---|---|
| C1 | 도구 바꿔도 기억 유지 / "Switch AI tools, keep your brain" (README:67, creed) + Portability 절 | TASK-098 완료(2026-07-23, 커밋 c0aa8a3): `export --verify` 왕복 무손실 검증 + `test/export-verify.test.js` 상설 + 실데이터 2379 facts 왕복 diff 0 실측 | "verified round-trip" 서술까지만 — guarantee/증명 단어 금지(README 현행 준수). 하드닝 잔여(fsync·대용량·딥 검증)는 TASK-107 | 릴리스마다 export-verify 테스트가 스위트에서 돌면 충족 | 왕복 diff≠0이 재현되면 이식 카피 전면 하향+INCIDENT |
| C2 | 코어 MIT 오픈소스, 계속 유지 (package.json:20, site 다수) | `package.json` license 필드 + 공개 리포 | — | 라이선스 변경은 그 자체가 신뢰 사건 — 변경 시 공개 기록 필수 | — |
| C3 | LLM 비결정성 4중 방어 (README:109) | 코드: 격리 cwd·포맷 예시·zero-parse 재시도·실패배치 no-op | troll delta(atoms +31%) 사고가 배경 — 방어는 완화지 제거 아님. "결정론" 류 표현 금지 | 재현성 게이트(자체볼트 2회 추출 겹침률) 측정치 나오면 수치 병기 | — |

## D. 근거 artifact 없는(미비한) 주장 → 후속 조치

| 항목 | 조치 |
|---|---|
| B4 scan 읽기전용 | **F1 resolved — 2026-07-23, TASK-106, artifact: `test/trust-guards.test.js`** |
| B1 무업로드의 자동 검증 | **F2 resolved — 2026-07-23, TASK-106, artifact: `scripts/check-network-allowlist.js`** |
| A3 정책 충돌 | **F3(유저 결정)**: README 0/24 노출 유지 여부 — 7/16 "외부 카피 금지" 합의와 충돌 상태 |
| 대장 자체의 부패 방지 | **F4 resolved — 2026-07-23, TASK-106, artifact: `scripts/check-trust-claims.js`** |

## 대장 운영 체크리스트 (카피 추가·변경 시)

- [ ] 새 정량·보안 주장인가? → 이 대장에 행 먼저 추가(근거 artifact 링크 필수)
- [ ] 근거가 "관측"인가 "보장"인가 — 관측이면 관측 서술로만(0/24 스타일), guarantee/proof/증명 단어 금지
- [ ] 표본 크기·유효 조건이 카피에서 탈락하지 않았는가
- [ ] 철회 조건을 한 줄로 쓸 수 없으면 그 주장은 싣지 않는다
