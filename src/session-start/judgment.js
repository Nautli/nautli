import fs from "node:fs";
import path from "node:path";

/**
 * Judgment script for the SessionStart index switchback experiment.
 *
 * Reads events from ~/.nautli/events/ and computes:
 * - useful_consumption_rate: proxy — recall with hits / eligible sessions
 *   (correction signal unavailable; "used without correction" approximated by non-empty recall)
 * - call_rate: sessions with recall / eligible sessions
 * - non_empty_rate: recall calls with >0 hits / total recall calls
 * - wrong_scope_rate: recall calls that returned facts outside session scope
 * - injection_tokens: total tokens injected by session-start
 *
 * Pre-decision rules (documented):
 * - treatment useful_consumption >= 3 absolute → proceed to default ON
 * - call_rate up but useful_consumption flat → tweak copy/retrieval
 * - any cross-scope or person leak in treatment → hold default ON
 * - cost reduction is NOT computed from this experiment
 */

function readEvents(home) {
  const directory = path.join(home, "events");
  if (!fs.existsSync(directory)) return [];
  const events = [];
  for (const file of fs.readdirSync(directory)
    .filter((name) => /^\d{4}-\d{2}\.jsonl$/u.test(name))
    .sort()) {
    for (const line of fs.readFileSync(path.join(directory, file), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // skip corrupted lines
      }
    }
  }
  return events;
}

export function computeJudgment(home, { since } = {}) {
  const events = readEvents(home);
  const sinceTime = since ? Date.parse(since) : 0;

  // Collect session-start index events
  const sessionStartEvents = new Map();
  for (const ev of events) {
    if (ev.ev !== "session_start.index") continue;
    if (since && Date.parse(ev.at) < sinceTime) continue;
    sessionStartEvents.set(ev.session_id, ev);
  }

  // Collect recall events per session
  const recallBySession = new Map();
  for (const ev of events) {
    if (ev.type !== "recall") continue;
    // TASK-104: 인덱스 주입 자체(tool="session-start.index")는 다운스트림 소비가 아니라
    // 전달 이벤트다 — 실험 소비 지표에서 제외해 자기계수(self-counting)를 막는다.
    if (ev.tool === "session-start.index") continue;
    if (since && Date.parse(ev.at) < sinceTime) continue;
    const sid = ev.session_id;
    if (!sid) continue;
    if (!recallBySession.has(sid)) recallBySession.set(sid, []);
    recallBySession.get(sid).push(ev);
  }

  // Eligible sessions: those with session_start.index event AND facts exist for that scope
  const arms = { 0: [], 1: [] };
  for (const [sessionId, startEv] of sessionStartEvents) {
    if (startEv.fact_count === 0) continue;
    const arm = startEv.experiment_arm;
    if (arm !== 0 && arm !== 1) continue;
    arms[arm].push({
      session_id: sessionId,
      scope: startEv.scope,
      fact_count: startEv.fact_count,
      tokens: startEv.tokens ?? 0,
      recalls: recallBySession.get(sessionId) ?? [],
    });
  }

  function armMetrics(sessions) {
    let totalRecalls = 0;
    let nonEmptyRecalls = 0;
    let wrongScopeRecalls = 0;
    let totalTokensInjected = 0;
    let sessionsWithRecall = 0;
    let usefulConsumptions = 0;

    for (const session of sessions) {
      totalTokensInjected += session.tokens;
      if (session.recalls.length > 0) sessionsWithRecall += 1;
      for (const recall of session.recalls) {
        totalRecalls += 1;
        const hits = Array.isArray(recall.hits) ? recall.hits : [];
        if (hits.length > 0) {
          nonEmptyRecalls += 1;
          // Useful consumption: recall with hits AND scope matches session (proxy — correction unavailable)
          if (!recall.scope || recall.scope === session.scope) {
            usefulConsumptions += 1;
          }
        }
        // Wrong scope: recall scope doesn't match session scope (includes person — HOLD rule)
        if (recall.scope && session.scope && recall.scope !== session.scope) {
          wrongScopeRecalls += 1;
        }
      }
    }

    const eligible = sessions.length;
    return {
      eligible_sessions: eligible,
      sessions_with_recall: sessionsWithRecall,
      call_rate: eligible > 0 ? sessionsWithRecall / eligible : null,
      total_recalls: totalRecalls,
      non_empty_recalls: nonEmptyRecalls,
      non_empty_rate: totalRecalls > 0 ? nonEmptyRecalls / totalRecalls : null,
      wrong_scope_recalls: wrongScopeRecalls,
      wrong_scope_rate: totalRecalls > 0 ? wrongScopeRecalls / totalRecalls : null,
      useful_consumptions: usefulConsumptions,
      useful_consumption_rate: eligible > 0 ? usefulConsumptions / eligible : null,
      // For control arm: potential tokens (not actually injected into context)
      total_tokens_injected: totalTokensInjected,
    };
  }

  const control = armMetrics(arms[0]);
  const treatment = armMetrics(arms[1]);

  // Pre-decision rules
  let decision = "CONTINUE";
  let reason = "Insufficient data";

  if (treatment.wrong_scope_recalls > 0) {
    decision = "HOLD";
    reason = `Cross-scope leak detected: ${treatment.wrong_scope_recalls} wrong-scope recall(s) in treatment arm`;
  } else if (treatment.useful_consumptions >= 3) {
    decision = "PROCEED";
    reason = `Treatment arm has ${treatment.useful_consumptions} useful consumptions (>= 3 threshold)`;
  } else if (treatment.sessions_with_recall > control.sessions_with_recall
    && treatment.useful_consumptions <= control.useful_consumptions) {
    decision = "TWEAK";
    reason = "Recall calls increased but useful consumption did not — adjust copy/retrieval";
  }

  return {
    version: 1,
    kind: "session-start-judgment",
    generated_at: new Date().toISOString(),
    proxy_note: "useful_consumption = recall with hits (correction signal unavailable)",
    since: since ?? null,
    control,
    treatment,
    decision,
    reason,
  };
}
