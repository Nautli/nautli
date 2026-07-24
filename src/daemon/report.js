import fs from "node:fs";
import path from "node:path";
import { buildHandoffCard, renderHandoffCard, handoffCardFactIds } from "../core/handoff-card.js";
import { resolveLocale, makeT } from "../i18n/strings.js";

function oneLine(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

export function writeReport(store, home, results) {
  // TASK-061: reports are summaries and handoff only; review queue cards are no longer rendered here.
  const t = makeT(resolveLocale());
  const machineOracle = results.machine_oracle ?? 0;
  const triageRouted = results.triage_routed ?? 0;
  const captureRemembered = results.capture_remembered ?? 0;
  const captureHeld = results.capture_held ?? 0;
  const oracle = results.oracle_resolve;
  const oracleResolved = Number(oracle?.resolved ?? 0)
    + Number(oracle?.remembered ?? 0)
    + Number(oracle?.discarded ?? 0);
  const oraclePromoted = Number(oracle?.promoted ?? 0);
  const hasOracleStats = oracle && ["resolved", "remembered", "discarded"]
    .some((field) => Object.hasOwn(oracle, field));
  const hasAppliedBreakdown = Object.hasOwn(results, "applied_duplicates")
    || Object.hasOwn(results, "applied_contradictions");
  const summaryParts = [
    ...(hasAppliedBreakdown
      ? [
        t("report.summary_applied_duplicates", { count: results.applied_duplicates ?? 0 }),
        t("report.summary_applied_contradictions", { count: results.applied_contradictions ?? 0 }),
      ]
      : [t("report.summary_applied", { count: results.applied ?? 0 })]),
    t("report.summary_queued", { count: results.queued ?? 0 }),
    t("report.summary_skipped", { count: results.skipped ?? 0 }),
  ];
  if (machineOracle > 0) summaryParts.push(t("report.summary_machine_oracle", { count: machineOracle }));
  if (triageRouted > 0) summaryParts.push(t("report.summary_triage_routed", { count: triageRouted }));
  if (captureRemembered > 0) summaryParts.push(t("report.summary_capture_remembered", { count: captureRemembered }));
  if (captureHeld > 0) summaryParts.push(t("report.summary_capture_held", { count: captureHeld }));
  if (hasOracleStats && Number.isFinite(oracleResolved)) {
    summaryParts.push(t("report.summary_oracle_resolved", { count: oracleResolved }));
  }
  if (oraclePromoted > 0) summaryParts.push(t("report.summary_oracle_promoted", { count: oraclePromoted }));
  const summary = t("report.summary_prefix", { text: summaryParts.join(", ") });
  const lines = [summary];
  const failedPairs = results.failed_pairs ?? 0;
  if (failedPairs > 0) {
    lines.push(t("report.failed_pairs", { count: failedPairs }));
  }
  if (machineOracle > 0) {
    lines.push(t("report.machine_oracle_note"));
  }
  if (triageRouted > 0) {
    lines.push(t("report.triage_routed_note"));
  }
  if (captureHeld > 0) {
    lines.push(t("report.capture_held_note"));
  }
  if (results.partial === true) {
    lines.push(t("report.partial"));
  }
  lines.push("");

  // Handoff card v2 (replaces v1 receipt in report body)
  const handoffCard = buildHandoffCard(home, store, { days: 1 });
  if (handoffCard && handoffCard.has_content) {
    const cardText = renderHandoffCard(handoffCard, t);
    if (cardText) {
      lines.push(cardText, "");
      // TASK-104: 렌더된 카드 텍스트가 확정된 뒤에만 전달을 로깅한다(자기계수 방지).
      // hit = 카드에 실제 렌더된 fact id들. 세션 미상이라 session_id는 "unknown".
      const deliveredIds = handoffCardFactIds(handoffCard);
      if (deliveredIds.length > 0) {
        store.appendRecall({
          tool: "handoff-card",
          query: "",
          scope: null,
          hits: deliveredIds,
          source: "daemon-report",
        });
      }
    }
  } else {
    lines.push(t("report.handoff_empty"), "");
  }

  const oracleDecisions = Array.isArray(oracle?.decisions) ? oracle.decisions : [];
  if (oracleDecisions.length > 0) {
    lines.push(t("report.oracle_heading"));
    oracleDecisions.forEach((decision, index) => {
      lines.push(
        `${index + 1}. ${oneLine(decision.decision)}: ${oneLine(decision.evidence_summary)}`,
      );
    });
    lines.push("");
  }

  // 로컬 날짜 필수 — UTC면 KST 새벽 실행(04:14)이 전날 리포트를 덮어쓴다 (실사고 2026-07-17)
  const date = new Date().toLocaleDateString("sv-SE");
  const file = path.join(home, "reports", `${date}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n").trimEnd()}\n`, "utf8");
  return { file };
}
