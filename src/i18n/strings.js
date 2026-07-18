export const STRINGS = Object.freeze({
  "cli.usage": {
    en: `nautli - One shared brain for every AI

dashboard  Open the dashboard to manage setup and memories
init       Initialize the memory store
setup      Configure AI connections and nightly digestion
remember   Save a new memory
recall     Search saved memories
checkup    Diagnose a notes folder for duplicates and contradictions. Example: nautli checkup ~/Documents/vault
daemon-run Run nightly digestion once
rebuild    Rebuild the memory store index
stats      Show memory store statistics
doctor     Check installation and store health
review     Answer questions that need your input
capture    Manage project capture consent and metrics
           View metrics: nautli capture metrics [--json]
purge      Permanently delete memories
mcp        Run the MCP server

New here? npx nautli dashboard`,
    ko: `nautli - 모든 AI가 공유하는 하나의 뇌

dashboard  설정과 기억을 관리하는 대시보드를 열어요.
init       기억 저장소를 초기화해요.
setup      AI 연결과 밤 소화를 설정해요.
remember   새 기억을 저장해요.
recall     저장된 기억을 검색해요.
checkup    노트 폴더를 진단해요(중복·모순 리포트). 예: nautli checkup ~/Documents/vault
daemon-run 밤 소화를 한 번 실행해요.
rebuild    기억 저장소 인덱스를 다시 만들어요.
stats      기억 저장소 통계를 보여줘요.
doctor     설치와 저장소 상태를 점검해요.
review     판단이 필요한 질문에 답해요.
capture    프로젝트 자동 캡처 동의와 계측을 관리해요.
           지표 보기: nautli capture metrics [--json]
purge      기억을 완전히 삭제해요.
mcp        MCP 서버를 실행해요.

처음이면: npx nautli dashboard`,
  },
  "cli.error.invalid_input": { en: "Check your input", ko: "입력 내용을 확인해 주세요." },
  "cli.checkup.other_running": { en: "A checkup is already running for another folder: {vault}. Try again when it finishes", ko: "다른 폴더 진단이 돌고 있어요: {vault}. 끝난 뒤 다시 시도해 주세요." },
  "cli.checkup.already_running": { en: "A checkup is already running for this folder. Watching it now", ko: "이미 이 폴더 진단이 돌고 있어요. 이어서 지켜볼게요." },
  "cli.checkup.claude_missing": { en: "Claude CLI is required. Install it with npm install -g @anthropic-ai/claude-code, then try again", ko: "claude CLI가 필요해요. npm install -g @anthropic-ai/claude-code 후 다시 실행해 주세요." },
  "cli.checkup.claude_login": { en: "Claude CLI login is required. Run claude /login, then try again", ko: "claude CLI 로그인이 필요해요. claude /login 후 다시 실행해 주세요." },
  "cli.checkup.started": { en: "Checkup started: {vault} (up to {maxFiles} sampled)", ko: "진단 시작: {vault} (표본 최대 {maxFiles}개)" },
  "cli.checkup.complete": { en: "Done. View the result in the nautli dashboard setup tab or at report_file", ko: "완료. nautli dashboard 설정 탭이나 report_file에서 결과를 볼 수 있어요." },
  "cli.checkup.judge_progress": { en: "Checking duplicates and contradictions {done}/{total} batches", ko: "중복·모순 판정 {done}/{total} 배치" },
  "cli.checkup.extract_progress": { en: "Extracting {done}/{total} batches", ko: "추출 {done}/{total} 배치" },
  "cli.checkup.timeout": { en: "The checkup may still be running. Check with nautli checkup --status", ko: "진단 프로세스가 아직 돌고 있을 수 있어요. nautli checkup --status 로 확인해 주세요." },
  "cli.metrics.not_measured": { en: "Not measured", ko: "측정 전" },
  "cli.metrics.seconds": { en: "{value}s", ko: "{value}초" },
  "cli.metrics.badge_pass": { en: "[PASS]", ko: "[통과]" },
  "cli.metrics.badge_kill": { en: "[STOP RECOMMENDED]", ko: "[중단 권고]" },
  "cli.metrics.badge_insufficient": { en: "[INSUFFICIENT SAMPLE]", ko: "[표본 부족]" },
  "cli.metrics.title": { en: "{badge} Auto-capture metrics · {days} days", ko: "{badge} 자동 캡처 계측 · {days}일" },
  "cli.metrics.header": { en: "Metric                Auto capture      Direct save", ko: "지표                  자동 캡처        직접 저장" },
  "cli.metrics.approval": { en: "Approval rate         {value}", ko: "승인율                {value}" },
  "cli.metrics.false_positive": { en: "False positive rate   {value}", ko: "오탐률                {value}" },
  "cli.metrics.review_latency": { en: "Median review time    {value}", ko: "검토시간 중앙값       {value}" },
  "cli.metrics.useful_recall": { en: "Useful recall rate    {auto}{explicit}", ko: "유용 회상률           {auto}{explicit}" },
  "cli.metrics.recall_refs": { en: "Recall refs per fact  {auto}{explicit}", ko: "fact당 회상 참조      {auto}{explicit}" },
  "cli.metrics.sample": { en: "Sample                candidates {candidates} · decisions {decided}/{minDecided} · recalls {recalls}/{minRecall}", ko: "표본                  후보 {candidates} · 결정 {decided}/{minDecided} · 회상 {recalls}/{minRecall}" },
  "cli.metrics.facts": { en: "Facts                 auto {auto} · direct {explicit} · sessions {sessions}", ko: "fact                  자동 {auto} · 직접 {explicit} · 세션 {sessions}" },
  "cli.metrics.need_more": { en: "Not enough data yet. Add {decided} question answers and {recalls} recalls to evaluate", ko: "아직 판정할 수 없어요. 질문 답변 {decided}건과 회상 {recalls}건이 더 필요해요." },
  "cli.metrics.pass_reason": { en: "All auto-capture retention criteria are met", ko: "자동 캡처 유지 기준을 모두 충족했습니다." },
  "cli.metrics.kill_reason": { en: "Some retention criteria were not met. Review candidate extraction and the approval flow", ko: "일부 유지 기준에 미달했습니다. 후보 추출 기준과 승인 전 검토 흐름을 조정하세요." },
  "cli.metrics.raw_reason": { en: "{reason}", ko: "{reason}" },
  "cli.capture.invalid_payload": { en: "Invalid capture hook payload", ko: "자동 캡처 훅 입력이 올바르지 않아요." },
  "cli.dashboard.invalid_port": { en: "Invalid dashboard port", ko: "대시보드 포트를 확인해 주세요." },
  "cli.daemon.not_built": { en: "daemon not built", ko: "데몬이 빌드되지 않았어요." },
  "cli.daemon.skipped_fresh": { en: "Digestion already succeeded for the current 03:30 slot ({last}); skipping this run", ko: "이번 03:30 슬롯의 소화가 이미 성공해서({last}) 이번 실행은 건너뛰어요." },
  "cli.setup.unknown_step": { en: "Unknown setup step: {name}", ko: "알 수 없는 설치 단계: {name}" },
  "cli.review.empty": { en: "No questions to answer. The next digestion runs at 3:30 AM", ko: "답할 질문이 없어요. 다음 소화는 오늘 새벽 3:30이에요." },
  "cli.review.duplicate": { en: "Duplicate", ko: "중복 정리" },
  "cli.review.contradiction": { en: "Contradiction", ko: "모순 발견" },
  "cli.review.duplicate_prompt": { en: "[O] Merge / [X] Keep separate / [L] Review tomorrow: ", ko: "[O] 합치기 / [X] 따로 유지 / [L] 내일 다시 보기: " },
  "cli.review.contradiction_prompt": { en: "[A] A is right / [B] B is right / [O] Both are right / [?] I don't know / Other correction: ", ko: "[A] A가 맞아요 / [B] B가 맞아요 / [O] 둘 다 맞아요 / [?] 몰라요 / 기타 정정문: " },
  "telemetry.first_run_notice": { en: "Telemetry is on by default. Only judgment meta (card counts, routing stats) is sent — never your notes or memory content. Turn it off anytime: nautli telemetry off", ko: "판정 메타 수집이 기본으로 켜져 있어요. 카드 개수와 판정 통계만 보내고 노트나 기억 내용은 절대 보내지 않아요. 끄려면: nautli telemetry off" },
  "cli.init.next": { en: "Next: npx nautli dashboard (opens setup)", ko: "다음 단계: npx nautli dashboard (설정 화면이 열려요)" },
  "cli.unknown_command": { en: "Unknown command: {command}", ko: "알 수 없는 명령: {command}" },

  "setup.command_not_allowed": { en: "Command not allowed: {command}", ko: "허용되지 않은 명령: {command}" },
  "setup.claude_missing": { en: "Claude CLI is not installed. Install it, then run the manual command", ko: "Claude CLI가 설치되어 있지 않아요. 설치한 뒤 수동 명령을 실행해 주세요." },
  "setup.claude_mcp_failed": { en: "Could not register the Claude MCP automatically. Run the command below in your terminal", ko: "Claude MCP 자동 등록에 실패했어요. 아래 명령을 터미널에서 실행해 주세요." },
  "setup.codex_missing": { en: "Codex CLI is not installed. Install it, then run the manual command", ko: "Codex CLI가 설치되어 있지 않아요. 설치한 뒤 수동 명령을 실행해 주세요." },
  "setup.codex_mcp_failed": { en: "Could not register the Codex MCP automatically. Run the command below in your terminal", ko: "Codex MCP 자동 등록에 실패했어요. 아래 명령을 터미널에서 실행해 주세요." },
  "setup.instructions_preview": { en: "Location: {file}\n\nBlock to add:\n{block}", ko: "추가될 위치: {file}\n\n추가될 블록:\n{block}" },
  "setup.instructions_broken_block": { en: "Found the start marker but not the end marker in {file}; not touching it. Remove the nautli block manually and reinstall.", ko: "{file}에서 시작 마커만 있고 끝 마커가 없어요. 파일을 건드리지 않았어요 — nautli 블록을 직접 지운 뒤 다시 설치해 주세요." },
  "setup.daemon_failed": { en: "Could not register the nightly digestion daemon. Run the command below in your terminal", ko: "밤 소화 데몬 등록에 실패했어요. 아래 명령을 터미널에서 실행해 주세요." },
  "setup.daemon_failed_conflict": { en: "If launchctl printed error 5 (Input/output error), the label com.nautli.daemon may already be loaded from another plist path. Run `launchctl bootout gui/{uid}/com.nautli.daemon` and retry", ko: "launchctl이 error 5(Input/output error)를 냈다면 com.nautli.daemon 라벨이 이미 다른 plist 경로로 로드돼 있을 수 있어요. `launchctl bootout gui/{uid}/com.nautli.daemon` 실행 후 다시 시도해 주세요." },
  "setup.app_darwin_only": { en: "The desktop app launcher is only supported on macOS for now.", ko: "데스크탑 앱 런처는 아직 macOS에서만 지원해요." },
  "setup.digest_judge_failed": { en: "Sample digestion failed: {reason}", ko: "체험 소화 판정에 실패했어요: {reason}" },
  "setup.digest_no_result": { en: "Found memories to digest but received no judgment. Check the Claude CLI connection", ko: "체험 소화할 기억은 찾았지만 판정 결과를 받지 못했어요. Claude CLI 연결을 확인해 주세요." },
  "setup.digest_already_running": { en: "Another digestion is already running; skipping this run", ko: "다른 소화가 이미 실행 중이라 이번 실행은 건너뛰어요." },

  "daemon.notify.title": { en: "nautli", ko: "nautli" },
  "daemon.notify.done_body": { en: "Night digestion done — {applied} applied, {pending} review card(s) waiting. Open the nautli app to answer.", ko: "밤 소화 완료 — 적용 {applied}건, 리뷰 카드 {pending}건 대기. nautli 앱에서 답해 주세요." },
  "daemon.notify.partial_body": { en: "Night digestion done — {applied} applied, {pending} review card(s) waiting. Some judgments will be retried during the next digestion. Open the nautli app to answer.", ko: "밤 소화 완료 — 적용 {applied}건, 리뷰 카드 {pending}건 대기. 일부 판정은 다음 소화 때 다시 시도해요. nautli 앱에서 답해 주세요." },
  "daemon.notify.failed_body": { en: "Night digestion failed — run npx nautli checkup to inspect.", ko: "밤 소화에 실패했어요 — npx nautli checkup으로 점검해 주세요." },

  "checkup.harness_claude": { en: "Claude harness (~/.claude)", ko: "Claude 하네스 (~/.claude)" },
  "checkup.harness_codex": { en: "Codex harness (~/.codex)", ko: "Codex 하네스 (~/.codex)" },
  "checkup.harness_gemini": { en: "Gemini harness (~/.gemini)", ko: "Gemini 하네스 (~/.gemini)" },
  "checkup.harness_cursor": { en: "Cursor harness (~/.cursor)", ko: "Cursor 하네스 (~/.cursor)" },
  "checkup.harness_shared": { en: "Shared memory (~/.shared-memory)", ko: "공유 메모리 (~/.shared-memory)" },
  "checkup.invalid_excludes": { en: "Check the excluded folder list", ko: "제외 폴더 목록을 확인해 주세요." },
  "checkup.top_level_only": { en: "Only top-level folders can be excluded", ko: "최상위 폴더만 제외할 수 있어요." },
  "checkup.path_required": { en: "Enter a folder path to check", ko: "진단할 폴더 경로를 입력해 주세요." },
  "checkup.folder_not_found": { en: "Folder not found. Check the path", ko: "폴더를 찾을 수 없어요. 경로를 확인해 주세요." },
  "checkup.home_only": { en: "Only folders inside your home folder can be checked", ko: "내 홈 폴더 안의 경로만 진단할 수 있어요." },
  "checkup.store_forbidden": { en: "The nautli store cannot check itself", ko: "nautli 저장소 자신은 진단 대상이 아니에요." },
  "checkup.no_markdown": { en: "No Markdown notes found in the selected folder", ko: "선택한 폴더에 진단할 마크다운 노트가 없어요." },
  "checkup.already_running": { en: "A checkup is already running. Results will appear here when it finishes", ko: "진단이 이미 돌고 있어요. 끝나면 결과가 여기 떠요." },
  "checkup.python_required": { en: "python3 is required. On macOS, install it with xcode-select --install", ko: "python3가 필요해요. macOS는 xcode-select --install 로 설치할 수 있어요." },
  "checkup.python_start_failed": { en: "Could not start the python3 checkup. {reason}", ko: "python3 진단을 시작하지 못했어요. {reason}" },
  "checkup.check_runtime": { en: "Check the runtime status", ko: "실행 상태를 확인해 주세요." },
  "checkup.report_missing": { en: "No report yet", ko: "아직 리포트가 없어요." },
  "checkup.import_missing": { en: "No checkup result to import", ko: "가져올 진단 결과가 없어요." },
  "checkup.memories_missing": { en: "No memories were extracted by the checkup", ko: "진단에서 추출된 기억이 없어요." },

  "mcp.briefing.cards_waiting": { en: "[nautli] {count} review card(s) are waiting for the user's answer. Please tell the user and point them to the dashboard (npx nautli dashboard).", ko: "[nautli] 리뷰 카드 {count}건이 사용자 답변을 기다리고 있어요. 사용자에게 알리고 대시보드(npx nautli dashboard)로 안내해 주세요." },
  "mcp.briefing.cards_waiting_backlog": { en: "[nautli] {count} review card(s) are waiting for the user's answer ({backlog} more will surface at up to 3 per day). Please tell the user and point them to the dashboard (npx nautli dashboard).", ko: "[nautli] 오늘의 리뷰 카드 {count}건이 답변을 기다리고 있어요. 대기 중인 {backlog}건은 하루 3건씩 순서대로 나와요. 사용자에게 알리고 대시보드(npx nautli dashboard)로 안내해 주세요." },
  "mcp.briefing.auto_cleanup": { en: "[nautli] {count} memories auto-organized so far ({undone} reversed by user).", ko: "[nautli] 기억 {count}건 자동 정리 완료 (사용자 되돌리기 {undone}건)." },
  "mcp.briefing.digest_stale": { en: "[nautli] Nightly digestion has not succeeded since {last}. Please suggest the user run npx nautli checkup.", ko: "[nautli] 밤 소화가 {last} 이후 성공하지 못했어요. 사용자에게 npx nautli checkup 점검을 권해 주세요." },
  "mcp.briefing.receipt": { en: "In the last {days} days, memory carried across {conversations} conversations and delivered about {tokens} tokens of relevant memory.", ko: "최근 {days}일, 기억으로 이어간 대화 {conversations}번, 필요한 기억 약 {tokens}토큰만 골라 건넸어요." },
  "mcp.briefing.receipt_building": { en: "Memory is building up. {facts} facts currently carry forward.", ko: "기억이 쌓이는 중이에요. 현재 이어지는 사실 {facts}개." },

  "report.summary_applied": { en: "{count} applied", ko: "적용 {count}건" },
  "report.summary_queued": { en: "{count} queued for review", ko: "리뷰 대기 추가 {count}건" },
  "report.summary_skipped": { en: "{count} skipped", ko: "건너뜀 {count}건" },
  "report.summary_machine_oracle": { en: "{count} held (technical record)", ko: "기술 기록 보류 {count}건" },
  "report.summary_triage_routed": { en: "{count} handled by AI", ko: "AI가 대신 맡음 {count}건" },
  "report.summary_capture_remembered": { en: "{count} auto-remembered by AI", ko: "AI가 대신 기억함 {count}건" },
  "report.summary_capture_held": { en: "{count} held", ko: "보류 {count}건" },
  "report.summary_oracle_resolved": { en: "{count} resolved by AI investigation", ko: "AI가 조사해 판결 {count}건" },
  "report.summary_oracle_promoted": { en: "{count} promoted to human", ko: "사람으로 승격 {count}건" },
  "report.summary_prefix": { en: "Summary: {text}.", ko: "요약: {text}." },
  "report.failed_pairs": { en: "({count} pair(s) skipped due to a temporary error; will retry next digestion)", ko: "(판정 {count}쌍은 일시 오류로 건너뜀: 다음 소화 때 다시 시도해요)" },
  "report.machine_oracle_note": { en: "(Technical record held: the answer is in the repo or logs, so the user was not asked)", ko: "(기술 기록 보류: 정답이 레포나 로그에 있는 갈림이라 사람에게 묻지 않았어요)" },
  "report.triage_routed_note": { en: "(Handled by AI: questions that do not need a human answer were held)", ko: "(AI가 대신 맡음: 사람이 답할 필요 없는 질문이라 보류해 뒀어요)" },
  "report.capture_held_note": { en: "(Held: uncertain automatic findings were kept on record without deleting)", ko: "(보류: 확정하기 어려운 자동 발견은 지우지 않고 기록에 남겼어요)" },
  "report.receipt_heading": { en: "## Savings receipt", ko: "## 절감 영수증" },
  "report.receipt_first_week": { en: "During the first week, we show how memories build up rather than savings", ko: "첫 주에는 절감보다 기억이 쌓이는 과정을 보여드려요" },
  "report.receipt_conversations": { en: "- {count} conversation(s)", ko: "- 대화 {count}번" },
  "report.receipt_tokens": { en: "- About {count} tokens of memory delivered", ko: "- 기억 약 {count}토큰 골라 건넴" },
  "report.receipt_organized": { en: "- {count} record(s) organized overnight", ko: "- 밤새 정리한 기록 {count}건" },
  "report.receipt_facts": { en: "- {active} active facts, {delta} this week", ko: "- 현재 이어지는 사실 {active}개, 이번 주 {delta}" },
  "report.handoff_heading": { en: "## Today's handoff card", ko: "## 오늘의 인수인계 카드" },
  "report.handoff_delivered": { en: "- Memory delivered: {claim} (across {sessions} session(s))", ko: "- 기억 전달: {claim} ({sessions}개 세션에 건넴)" },
  "report.handoff_last_activity": { en: "- Last active: {scope} (at {at})", ko: "- 마지막 활동: {scope} ({at})" },
  "report.handoff_delta_heading": { en: "- New/updated facts:", ko: "- 어제 배운 것:" },
  "report.handoff_delta_added": { en: "  - + {claim}", ko: "  - + {claim}" },
  "report.handoff_delta_replaced": { en: "  - {old} -> {new}", ko: "  - {old} -> {new}" },
  "report.handoff_delta_more": { en: "  - ...and {count} more", ko: "  - ...외 {count}건" },
  "report.handoff_tokens": { en: "- Memory injected: {tokens} tokens (on-demand recall, not always-loaded)", ko: "- 기억 주입: {tokens}토큰 (필요할 때만 recall, 상시 로딩 아님)" },
  "report.handoff_tokens_baseline": { en: "- Memory injected: {tokens} tokens (always-loaded baseline {baseline_tokens} tokens, {pct}% lighter)", ko: "- 기억 주입: {tokens}토큰 (상시 로딩 {baseline_tokens}토큰 대비 {pct}% 경량)" },
  "report.handoff_empty": { en: "No new handoff today.", ko: "오늘은 새 인수인계가 없어요." },
  "report.oracle_heading": { en: "## AI investigation verdicts", ko: "## AI 조사 판결" },
  "report.card_headline_duplicate": { en: "These two memories look like the same thing.", ko: "이 두 기억이 같은 내용 같아요." },
  "report.card_headline_contradiction": { en: "These two memories seem hard to both be true.", ko: "두 기억이 동시에 맞기 어려워 보여요." },
  "report.card_question_duplicate": { en: "Merge into one? (O / X / not sure)", ko: "하나로 합칠까요? (O / X / 모름)" },
  "report.card_question_contradiction": { en: "Which one is correct now? (A / B / both / not sure)", ko: "지금은 어느 쪽이 맞나요? (A / B / 둘 다 / 모름)" },
  "report.card_recommendation": { en: "Daemon recommendation: {side} looks newer (confidence {pct}%)", ko: "데몬 추천: {side}가 최신으로 보여요 (확신 {pct}%)" },
  "report.card_heading": { en: "## Review card {index}", ko: "## 리뷰 카드 {index}" },
  "report.card_question_label": { en: "Question: {text}", ko: "질문: {text}" },
  "report.card_dashboard": { en: "Respond on the dashboard: npx nautli dashboard", ko: "응답은 대시보드에서: npx nautli dashboard" },
  "report.card_reference": { en: "Reference (original)", ko: "참고(원문)" },
  "report.card_verdict": { en: "- Verdict: {verdict} {confidence} \u00b7 pair: {pair_id}{reason}", ko: "- 판정: {verdict} {confidence} \u00b7 pair: {pair_id}{reason}" },
  "report.card_reason_prefix": { en: " \u00b7 reason: {reason}", ko: " \u00b7 이유: {reason}" },
  "report.deferred": { en: "Deferred: {count}", ko: "이월: {count}건" },

  "sample.duplicate_a": { en: "Sample review-duplicate memo: meeting summaries are recorded in team docs", ko: "체험용 검토중복 메모: 회의 요약은 팀 문서에 기록한다" },
  "sample.duplicate_b": { en: "Sample review-duplicate memo: record meeting summaries in team docs", ko: "체험용 검토중복 메모: 팀 문서에 회의 요약을 기록한다" },
  "sample.contradiction_a": { en: "Sample: the service port is 3100", ko: "체험용 서비스 포트는 3100이다" },
  "sample.contradiction_b": { en: "Sample: the service port was changed to 3200", ko: "체험용 서비스 포트는 3200으로 변경되었다" },

  "dash.error.invalid_input": { en: "Check your input", ko: "입력 내용을 확인해 주세요." },
  "dash.error.multi_fact": { en: "Add one memory at a time", ko: "한 번에 한 가지 기억만 추가해 주세요." },
  "dash.error.claim_too_long": { en: "Keep memories under 280 characters", ko: "기억은 280자 이내로 적어 주세요." },
  "dash.error.unknown_scope": { en: "Use person, procedure, or project:name for scope", ko: "scope는 개인, 절차 또는 project:이름 형식이어야 해요." },
  "dash.error.not_found": { en: "Not found. Refresh and try again", ko: "대상을 찾을 수 없어요. 상태를 새로고침해 주세요." },
  "dash.error.store_busy": { en: "The memory store is busy. Try again shortly", ko: "기억 저장소가 사용 중이에요. 잠시 후 다시 시도해 주세요." },
  "dash.error.budget_small": { en: "The search budget is too small", ko: "검색 예산이 너무 작아요." },
  "dash.error.claude_missing": { en: "Claude CLI is not installed", ko: "Claude CLI가 설치되어 있지 않아요." },
  "dash.error.codex_missing": { en: "Codex CLI is not installed", ko: "Codex CLI가 설치되어 있지 않아요." },
  "dash.error.mcp_failed": { en: "Could not register the Claude MCP automatically", ko: "Claude MCP 자동 등록에 실패했어요." },
  "dash.error.daemon_failed": { en: "Could not register the nightly digestion daemon", ko: "밤 소화 데몬 등록에 실패했어요." },
  "dash.error.extract_failed": { en: "Could not extract memory candidates from the conversation", ko: "대화에서 기억 후보를 뽑지 못했어요." },
  "dash.error.duplicate": { en: "This memory is already saved", ko: "이미 같은 기억이 저장되어 있어요." },
  "dash.error.generic": { en: "Could not process the request", ko: "요청을 처리하지 못했어요." },
  "dash.scope.person": { en: "Personal", ko: "개인" },
  "dash.scope.procedure": { en: "Procedure", ko: "절차" },
  "dash.scope.project": { en: "Project {name}", ko: "프로젝트 {name}" },
  "dash.scan.failed": { en: "Could not detect AI usage. Try again", ko: "AI 사용량을 감지하지 못했어요. 다시 시도해 주세요." },
  "dash.host_forbidden": { en: "Only local dashboard requests are allowed", ko: "이 컴퓨터의 대시보드 요청만 처리할 수 있어요." },
  "dash.origin_forbidden": { en: "Only requests from this dashboard are allowed", ko: "이 대시보드에서 보낸 요청만 처리할 수 있어요." },
  "dash.checkup.claude_install": { en: "Install Claude CLI, then log in", ko: "Claude CLI를 설치한 뒤 로그인해 주세요." },
  "dash.checkup.claude_login": { en: "Claude CLI login is required. Run claude in your terminal to log in", ko: "Claude CLI 로그인이 필요해요. 터미널에서 claude를 실행해 로그인해 주세요." },
  "dash.digest.claude_required": { en: "Digestion requires Claude CLI. Complete Connect Claude Code first", ko: "소화에는 Claude CLI가 필요해요. 먼저 'Claude Code 연결' 단계를 완료해 주세요." },
  "dash.digest.claude_login": { en: "Claude CLI login is required", ko: "Claude CLI 로그인이 필요해요." },
  "dash.setup.not_found": { en: "Setup step not found", ko: "설치 단계를 찾을 수 없어요." },
  "dash.api.not_found": { en: "API not found", ko: "API를 찾을 수 없어요." },
  "dash.method_not_allowed": { en: "Request method not allowed", ko: "허용되지 않은 요청 방식이에요." },
});

export function resolveLocale(env = process.env) {
  const override = String(env?.NAUTLI_LANG ?? "").toLowerCase();
  if (override === "ko" || override === "en") return override;

  const detected = env?.LC_ALL || env?.LANG || "";
  return String(detected).toLowerCase().startsWith("ko") ? "ko" : "en";
}

export function makeT(locale) {
  const selected = locale === "ko" ? "ko" : "en";
  return (key, vars = {}) => {
    const entry = STRINGS[key];
    if (!entry) return key;
    const template = entry[selected] ?? entry.en ?? key;
    return template.replace(/\{([A-Za-z0-9_]+)\}/gu, (match, name) => (
      Object.hasOwn(vars, name) ? String(vars[name]) : match
    ));
  };
}
