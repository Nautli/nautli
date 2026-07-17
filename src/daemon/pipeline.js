import fs from "node:fs";
import path from "node:path";
import { drainOnce } from "../capture/drain.js";
import { listOptedProjects } from "../capture/consent.js";
import { findPairs } from "./pair.js";
import { judgePairs } from "./judge.js";
import { triageCards, triagePendingQueue } from "./triage.js";
import { resolveRoutedQueue } from "./resolve.js";
import { applyJudgments } from "./apply.js";
import { writeReport } from "./report.js";
import { renderViews } from "./render.js";
import {
  buildTelemetryPayload,
  isTelemetryEnabled,
  sendTelemetry,
} from "./telemetry.js";

function recordStage(home, stage, detail) {
  const file = path.join(home, "daemon", "journal.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({
    kind: "stage",
    stage,
    at: new Date().toISOString(),
    ...detail,
  })}\n`, "utf8");
}

export async function runOnce(store, home, config, { dry = false } = {}) {
  const pairs = findPairs(store);
  recordStage(home, "pair", { count: pairs.length });

  const capture = async () => {
    try {
      if (!listOptedProjects(home).some((project) => project.enabled)) {
        return { skipped: true, reason: "no_opted_projects" };
      }
      return await drainOnce(home, config, { dry });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  if (dry) {
    return { dry: true, pairs: pairs.length, capture: await capture() };
  }

  const judgeResult = await judgePairs(pairs, store, config, home);
  recordStage(home, "judge", {
    count: judgeResult.parsedCount,
    errors: judgeResult.errors.length,
  });

  const triageStats = { checked: 0, human: 0, routed: 0 };
  const triageCandidates = [];
  const judgmentsByPair = new Map();
  for (const judgment of judgeResult.judgments) {
    const confidence = Number(judgment?.confidence);
    const eligible = (judgment?.verdict === "duplicate" && confidence >= 0.6 && confidence < 0.9)
      || (judgment?.verdict === "contradiction" && confidence >= 0.6);
    if (!eligible || judgment.oracle === "machine") continue;
    const ids = typeof judgment.pair_id === "string" ? judgment.pair_id.split(":") : [];
    const a = ids.length === 2 ? store.getFact(ids[0]) : null;
    const b = ids.length === 2 ? store.getFact(ids[1]) : null;
    if (!a || !b) continue;
    triageCandidates.push({
      pair_id: judgment.pair_id,
      verdict: judgment.verdict,
      crux: judgment.crux,
      reason: judgment.reason,
      claim_a: a.claim,
      claim_b: b.claim,
      scope: a.scope === b.scope ? a.scope : `${a.scope} | ${b.scope}`,
    });
    judgmentsByPair.set(judgment.pair_id, judgment);
  }
  triageStats.checked = triageCandidates.length;
  triageStats.human = triageCandidates.length;
  // triage_cmd === false는 명시적 opt-out(테스트·트리아지 미사용 환경) — 기본값은 opus 트리아지 on
  if (triageCandidates.length > 0 && config?.triage_cmd !== false) {
    try {
      const triaged = await triageCards(triageCandidates, config, home);
      for (const [pairId, result] of triaged) {
        const judgment = judgmentsByPair.get(pairId);
        if (!judgment) continue;
        judgment.route = result.route;
        if (typeof result.crux_plain === "string") judgment.crux_plain = result.crux_plain;
        if (result.route !== "human") {
          triageStats.human -= 1;
          triageStats.routed += 1;
        }
      }
    } catch {
      // 트리아지 설정·호출 실패는 fail-open: 기존 사람 큐 동작으로 계속 진행한다.
    }
  }
  recordStage(home, "triage", triageStats);

  const appliedResults = applyJudgments(store, judgeResult.judgments, config);
  recordStage(home, "apply", appliedResults);

  const result = {
    pairs: pairs.length,
    judgments: judgeResult.parsedCount,
    judge_errors: judgeResult.errors,
    ...appliedResults,
  };
  result.capture = await capture();
  recordStage(home, "capture", result.capture);

  if (config?.triage_cmd !== false) {
    try {
      result.capture_triage = await triagePendingQueue(store, home, config);
    } catch (error) {
      result.capture_triage = {
        checked: 0,
        routed: 0,
        kept: 0,
        capture_remembered: 0,
        capture_held: 0,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  } else {
    result.capture_triage = { skipped: true, reason: "disabled" };
  }
  recordStage(home, "capture_triage", result.capture_triage);

  if (config?.resolve_cmd !== false) {
    try {
      result.oracle_resolve = await resolveRoutedQueue(store, home, config);
    } catch (error) {
      result.oracle_resolve = {
        checked: 0,
        resolved: 0,
        remembered: 0,
        discarded: 0,
        promoted: 0,
        unresolved: 0,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  } else {
    result.oracle_resolve = { skipped: true, reason: "disabled" };
  }
  recordStage(home, "oracle_resolve", result.oracle_resolve);

  result.report = writeReport(store, home, {
    ...appliedResults,
    ...result.capture_triage,
    oracle_resolve: result.oracle_resolve,
  });
  recordStage(home, "report", { file: result.report.file, cards: result.report.cards });

  result.views = renderViews(store, home);
  recordStage(home, "render", { count: result.views.files.length });

  result.telemetry = { sent: false };
  if (isTelemetryEnabled(config)) {
    try {
      const sendConfig = { ...config };
      Object.defineProperty(sendConfig, "__telemetryHome", { value: home });
      const payload = buildTelemetryPayload(home, store);
      result.telemetry.sent = await sendTelemetry(payload, sendConfig);
    } catch {
      result.telemetry.sent = false;
    }
    try {
      recordStage(home, "telemetry", result.telemetry);
    } catch {
      // 선택 수집의 기록 실패는 소화 결과에 영향을 주지 않는다.
    }
  }
  return result;
}
