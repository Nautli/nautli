import fs from "node:fs";
import path from "node:path";
import { findPairs } from "./pair.js";
import { judgePairs } from "./judge.js";
import { applyJudgments } from "./apply.js";
import { writeReport } from "./report.js";
import { renderViews } from "./render.js";

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

  if (dry) return { dry: true, pairs: pairs.length };

  const judgeResult = await judgePairs(pairs, store, config, home);
  recordStage(home, "judge", {
    count: judgeResult.parsedCount,
    errors: judgeResult.errors.length,
  });

  const appliedResults = applyJudgments(store, judgeResult.judgments, config);
  recordStage(home, "apply", appliedResults);

  const report = writeReport(store, home, appliedResults);
  recordStage(home, "report", { file: report.file, cards: report.cards });

  const views = renderViews(store, home);
  recordStage(home, "render", { count: views.files.length });

  return {
    pairs: pairs.length,
    judgments: judgeResult.parsedCount,
    judge_errors: judgeResult.errors,
    ...appliedResults,
    report,
    views,
  };
}
