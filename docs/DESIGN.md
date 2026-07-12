# nautli 대시보드 DESIGN 토큰 v1 (비주얼 SSOT — 토큰 외 색/폰트 발명 금지)

## 콘셉트
"밤 → 새벽": 데몬이 밤에 일하고 유저는 새벽(아침)을 만난다. 어둡되 음침하지 않게 — nightmare 잔상 차단이 브랜드 과제이므로 **따뜻한 여명 액센트가 필수**.

## 컬러 (다크 단일 테마, v0)
- --bg: #12141f (짙은 남색 밤하늘 — 순검정 금지)
- --bg-card: #1a1d2e
- --bg-raised: #232742 (hover/선택)
- --border: #2e3350
- --text: #e8e9f0
- --text-dim: #9a9fb8
- --accent-dawn: #f0a860 (여명 주황 — 주 액션 버튼, 활성 탭, 헬스 양호)
- --accent-dawn-soft: #f0a86022 (배경용)
- --ok: #6fd08c (성공/완료 체크)
- --warn: #e8c268 (경고 — 24h+ 미소화 등)
- --danger: #e07070 (에러 결과에만. **idle 버튼에 위험색 금지** — X/기각 버튼도 평상시 --bg-raised, hover 시만 --danger 테두리)
- 상태 배지: active=--ok 점 / superseded·invalidated=--text-dim + 도장(🔖) 아이콘, 취소선 금지

## 타이포
- 시스템 스택: -apple-system, 'Pretendard', sans-serif. 코드·명령어 = ui-monospace, 'SF Mono', monospace. **claim 원문은 산세리프 500** (⚠️SF Mono엔 한글 글리프가 없어 한국어 claim을 mono로 지정하면 폴백 렌더로 어절 간격이 붕 뜸 — v3 검안 2회 연속 적발된 원인)
- 크기: 본문 14px / claim 15px sans 500 / 섹션 제목 13px 대문자 letter-spacing .08em --text-dim / 페이지 제목 20px 600

## 형태
- radius: 카드 12px, 버튼 8px, 배지 999px
- 카드: --bg-card + 1px --border, 패딩 20px, 그림자 없음(플랫)
- 버튼: 주 액션 = --accent-dawn 배경+#12141f 글자 / 보조 = 투명+1px --border / 파괴적 결과 확인시에만 --danger
- 간격 단위 4px 배수, 페이지 최대폭 860px 중앙

## 시그니처 1개: 여명 진행 바
헤더 하단 2px 바 — 왼쪽(밤 #2e3350)에서 오른쪽(여명 --accent-dawn) 그라데이션. 마지막 소화 시각~다음 소화까지의 진행을 표현. 데몬 미설치 시 회색 점선.

## 상태별 룰
- 빈 상태: 이모지 금지, 차분한 문장 + 다음 행동 1개 ("검토할 카드가 없어요. 다음 소화는 3:30입니다.")
- 로딩: 스피너 대신 버튼 라벨 교체("등록 중…")+disabled
- 토스트: 우하단, 성공 --ok 좌측 바 / 실패 --danger 좌측 바 + 사람말 사유 1문장

## 브랜드 표기 규칙 (2026-07-12 확정)
- **모든 곳에서 소문자 `nautli`** — CLI·npm·도메인·로고 워드마크 (bun/deno/vercel 혈통)
- 어원 레이어: **g**lia(뇌세포)+**lymph**(청소) — 로고에서 g/lymph 색 분리 가능 (여명 주황)
- 파비콘/앱아이콘: 자음 압축(GLMF류) 금지 — g 모노그램 or 여명 바 심볼. 압축형은 굿즈 이스터에그로만
- 발음 표기: /glimf/ 글림프. 태그라인: "Your agents learn by day. nautli cleans by night." / "Wake up smarter."
- 근거: RTFKT식 압축은 원본이 보편 단어일 때만 복원됨 — nautli는 희귀 단어라 압축 시 사망 (제품명-후보-v1 v8~9)
