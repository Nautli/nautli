# onebrain (가칭)

네 모든 AI가 공유하는 하나의 뇌. 기억은 fact 단위로 쌓이고, 소화 데몬이 자는 동안 정리하며(중복 병합·모순 무효화·망각), 정본은 네 디스크의 파일이다.

- 스펙 정본: [SPEC.md](SPEC.md) / 전략: `Evanwiki/신사업/크로스AI-메모리-_hub.md`
- 상태: v0 (2026-07-11 밤샘 빌드). 테스트 20/20, 실 judge 유저스토리 검증 완료.

## 빠른 시작
```bash
cd ~/Desktop/onebrain && npm install   # 이미 됨
node src/cli.js init                    # ~/.onebrain 생성
node src/cli.js remember "우리 API 포트는 4000이다" --scope project:myapp
node src/cli.js recall "포트" --scope project:myapp
node src/cli.js daemon-run              # 소화 1회 (judge = claude CLI, 구독 $0)
node src/cli.js rebuild                 # 인덱스 재구성 (정본=events/*.jsonl 증명)
```

## Claude Code에 MCP 등록 (도그푸딩)
```bash
claude mcp add onebrain -- node ~/Desktop/onebrain/src/mcp/server.js
# 툴: remember / recall / briefing
```

## 구조 (SPEC §1)
`src/core` 저장·게이트·recall — `src/mcp` stdio 서버 — `src/cli.js` — `src/daemon` pair→judge→apply→report→render

## 불변식 (위반=버그, 테스트로 고정)
정본=유저 파일(rebuild 왕복) / facts DELETE 금지 / 쓰기 단일패스·정리는 데몬만 / 데몬 죽어도 코어 동작 / recall에 프로모션 주입 금지 / 애매하면 no-op(오병합 비대칭)

## 알려진 한계 (v0)
- t_valid 날짜 단위 → 같은 날 모순은 recorded 시각+문맥으로 판정 (judge에 위임)
- judge LLM 비결정성 → 격리 cwd+포맷 예시+0파싱 재시도+실패 배치 no-op 4중 방어
- 임베딩 미탑재 (FTS 프리픽스만) — v1.1 예약
- 중복 병합 방향이 t_valid 기준 → 부분집합이 최신이면 상위집합이 접힐 위험 (교차검수에서 발견, 실손실 0). v0.2: judge에 keep 필드 추가해 "정보 적은 쪽을 접는" 규칙으로 교체
