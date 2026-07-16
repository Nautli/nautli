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
  "cli.daemon.skipped_fresh": { en: "Last digestion succeeded within 24 hours ({last}); skipping this run", ko: "최근 24시간 안에 소화가 성공해서({last}) 이번 실행은 건너뛰어요." },
  "cli.setup.unknown_step": { en: "Unknown setup step: {name}", ko: "알 수 없는 설치 단계: {name}" },
  "cli.review.empty": { en: "No questions to answer. The next digestion runs at 3:30 AM", ko: "답할 질문이 없어요. 다음 소화는 오늘 새벽 3:30이에요." },
  "cli.review.duplicate": { en: "Duplicate", ko: "중복 정리" },
  "cli.review.contradiction": { en: "Contradiction", ko: "모순 발견" },
  "cli.review.duplicate_prompt": { en: "[O] Merge / [X] Keep separate / [L] Review tomorrow: ", ko: "[O] 합치기 / [X] 따로 유지 / [L] 내일 다시 보기: " },
  "cli.review.contradiction_prompt": { en: "[A] A is right / [B] B is right / [O] Both are right / [?] I don't know / Other correction: ", ko: "[A] A가 맞아요 / [B] B가 맞아요 / [O] 둘 다 맞아요 / [?] 몰라요 / 기타 정정문: " },
  "cli.init.next": { en: "Next: npx nautli dashboard (opens setup)", ko: "다음 단계: npx nautli dashboard (설정 화면이 열려요)" },
  "cli.unknown_command": { en: "Unknown command: {command}", ko: "알 수 없는 명령: {command}" },

  "setup.command_not_allowed": { en: "Command not allowed: {command}", ko: "허용되지 않은 명령: {command}" },
  "setup.claude_missing": { en: "Claude CLI is not installed. Install it, then run the manual command", ko: "Claude CLI가 설치되어 있지 않아요. 설치한 뒤 수동 명령을 실행해 주세요." },
  "setup.claude_mcp_failed": { en: "Could not register the Claude MCP automatically. Run the command below in your terminal", ko: "Claude MCP 자동 등록에 실패했어요. 아래 명령을 터미널에서 실행해 주세요." },
  "setup.codex_missing": { en: "Codex CLI is not installed. Install it, then run the manual command", ko: "Codex CLI가 설치되어 있지 않아요. 설치한 뒤 수동 명령을 실행해 주세요." },
  "setup.codex_mcp_failed": { en: "Could not register the Codex MCP automatically. Run the command below in your terminal", ko: "Codex MCP 자동 등록에 실패했어요. 아래 명령을 터미널에서 실행해 주세요." },
  "setup.instructions_preview": { en: "Location: {file}\n\nBlock to add:\n{block}", ko: "추가될 위치: {file}\n\n추가될 블록:\n{block}" },
  "setup.daemon_failed": { en: "Could not register the nightly digestion daemon. Run the command below in your terminal", ko: "밤 소화 데몬 등록에 실패했어요. 아래 명령을 터미널에서 실행해 주세요." },
  "setup.daemon_failed_conflict": { en: "If launchctl printed error 5 (Input/output error), the label com.nautli.daemon may already be loaded from another plist path. Run `launchctl bootout gui/{uid}/com.nautli.daemon` and retry", ko: "launchctl이 error 5(Input/output error)를 냈다면 com.nautli.daemon 라벨이 이미 다른 plist 경로로 로드돼 있을 수 있어요. `launchctl bootout gui/{uid}/com.nautli.daemon` 실행 후 다시 시도해 주세요." },
  "setup.digest_judge_failed": { en: "Sample digestion failed: {reason}", ko: "체험 소화 판정에 실패했어요: {reason}" },
  "setup.digest_no_result": { en: "Found memories to digest but received no judgment. Check the Claude CLI connection", ko: "체험 소화할 기억은 찾았지만 판정 결과를 받지 못했어요. Claude CLI 연결을 확인해 주세요." },
  "setup.digest_already_running": { en: "Another digestion is already running; skipping this run", ko: "다른 소화가 이미 실행 중이라 이번 실행은 건너뛰어요." },

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
