import fs from "node:fs";
import path from "node:path";
import { buildHandoffCard, renderHandoffCard } from "../core/handoff-card.js";
import { buildReceipt } from "../core/receipt.js";
import { resolveLocale, makeT } from "../i18n/strings.js";

function pendingReviews(home) {
  const file = path.join(home, "review", "queue.jsonl");
  if (!fs.existsSync(file)) return [];
  const pending = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const entry = JSON.parse(line);
      if (entry.status === "pending") pending.push(entry);
    } catch {
      // Ignore an incomplete trailing line.
    }
  }
  return pending;
}

function oneLine(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

export function writeReport(store, home, results) {
  const t = makeT(resolveLocale());
  const pending = pendingReviews(home).filter((review) => review.type !== "capture");
  const cards = pending.slice(0, 3);
  const deferred = Math.max(0, pending.length - cards.length);
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
  const summaryParts = [
    t("report.summary_applied", { count: results.applied ?? 0 }),
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
  lines.push("");

  // Handoff card v2 (replaces v1 receipt in report body)
  const handoffCard = buildHandoffCard(home, store, { days: 1 });
  if (handoffCard && handoffCard.has_content) {
    const cardText = renderHandoffCard(handoffCard, t);
    if (cardText) lines.push(cardText, "");
  } else {
    lines.push(t("report.handoff_empty"), "");
  }

  // Legacy receipt (kept for dashboard/MCP — not rendered in report)
  const receipt = buildReceipt(home, store);
  void receipt;

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

  cards.forEach((review, index) => {
    const duplicate = review.verdict === "duplicate";
    const headline = oneLine(review.crux_plain) || oneLine(review.crux) || (duplicate
      ? t("report.card_headline_duplicate")
      : t("report.card_headline_contradiction"));
    const question = duplicate
      ? t("report.card_question_duplicate")
      : t("report.card_question_contradiction");
    const recommendation = review.newer === "a" || review.newer === "b"
      ? t("report.card_recommendation", { side: review.newer.toUpperCase(), pct: Math.round(Number(review.confidence) * 100) })
      : null;
    const reason = oneLine(review.reason);
    const reasonSuffix = reason ? t("report.card_reason_prefix", { reason }) : "";
    lines.push(
      t("report.card_heading", { index: index + 1 }),
      `**${headline}**`,
      t("report.card_question_label", { text: question }),
    );
    if (recommendation) lines.push(recommendation);
    lines.push(
      t("report.card_dashboard"),
      "",
      t("report.card_reference"),
      `- A: ${oneLine(review.claims?.a)}`,
      `- B: ${oneLine(review.claims?.b)}`,
      t("report.card_verdict", { verdict: review.verdict, confidence: review.confidence, pair_id: review.pair_id, reason: reasonSuffix }),
      "",
    );
  });
  if (deferred > 0) lines.push(t("report.deferred", { count: deferred }), "");

  // 로컬 날짜 필수 — UTC면 KST 새벽 실행(04:14)이 전날 리포트를 덮어쓴다 (실사고 2026-07-17)
  const date = new Date().toLocaleDateString("sv-SE");
  const file = path.join(home, "reports", `${date}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n").trimEnd()}\n`, "utf8");
  return { file, pending: pending.length, cards: cards.length, deferred };
}
