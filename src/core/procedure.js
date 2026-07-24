// TASK-067: 절차 발동 라우터 — 순수 매처 엔진.
// 저장/이벤트 정본은 store(procedure_triggers 파생 표)가, 실제 훅 파일은 레포 밖이 담당한다.
// 이 모듈은 (트리거 후보들, 질의)만 받아 발동 대상을 우선순위로 정렬해 돌려주는 순수 함수다.

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim() !== "")
    .map((item) => item.trim());
}

// 트리거 메타데이터를 정규화한다. 알 수 없는/누락 필드는 안전 기본값으로 채운다.
export function normalizeTrigger(raw) {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  let priority = Number(obj.priority);
  if (!Number.isFinite(priority)) priority = 0;
  priority = Math.min(100, Math.max(0, Math.trunc(priority)));
  return {
    intent: stringArray(obj.intent),
    includes: stringArray(obj.includes),
    excludes: stringArray(obj.excludes),
    tool_events: stringArray(obj.tool_events),
    scope: typeof obj.scope === "string" && obj.scope.trim() !== "" ? obj.scope.trim() : null,
    priority,
  };
}

/**
 * 발동 대상 매칭.
 * @param candidates [{ fact_id, claim, scope, trigger }] — active procedure fact들의 트리거.
 * @param query { current_intent, scope, tool_event }
 * @returns [{ fact_id, claim, scope, priority, matched_via }] priority 내림차순.
 */
export function matchProcedures(candidates, { current_intent = "", scope, tool_event } = {}) {
  const intentText = String(current_intent ?? "").toLowerCase();
  const hasScope = scope !== undefined && scope !== null && scope !== "";
  const hasToolEvent = tool_event !== undefined && tool_event !== null && tool_event !== "";
  const out = [];

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const trigger = normalizeTrigger(candidate?.trigger);

    // scope 필터(대상 범위): 트리거가 scope를 지정했고 질의 scope가 주어졌으면 정확히 일치해야 한다.
    if (trigger.scope && hasScope && trigger.scope !== scope) continue;

    // 제외: 제외 키워드가 하나라도 intent에 나타나면 발동하지 않는다.
    if (trigger.excludes.some((keyword) => intentText.includes(keyword.toLowerCase()))) continue;

    // tool-event 질의: tool_event가 주어지면 트리거가 그 이벤트를 구독할 때만 후보다.
    const toolEventMatched = hasToolEvent && trigger.tool_events.includes(tool_event);
    if (hasToolEvent && !toolEventMatched) continue;

    // 대상(positive) 매칭: intent/includes 키워드 중 하나라도 현재 intent에 나타나면 대상.
    // 키워드가 하나도 없는 트리거는 intent로는 catch-all(단, tool-event 질의는 위에서 이미 게이트됨).
    const positives = [...trigger.intent, ...trigger.includes];
    const intentMatched = positives.length === 0
      || positives.some((keyword) => intentText.includes(keyword.toLowerCase()));
    if (!intentMatched && !toolEventMatched) continue;

    out.push({
      fact_id: candidate.fact_id,
      claim: candidate.claim,
      scope: candidate.scope,
      priority: trigger.priority,
      matched_via: toolEventMatched ? "tool_event" : "intent",
    });
  }

  out.sort((left, right) => right.priority - left.priority
    || String(left.fact_id).localeCompare(String(right.fact_id)));
  return out;
}
