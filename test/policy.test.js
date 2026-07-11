import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { applyJudgments } from "../src/daemon/apply.js";
import { STATUS } from "../src/core/schema.js";

// v0 정책 (유저 라벨 실측 2026-07-11): 모순은 기본 자동 적용 금지 — 고신뢰(0.95)여도 리뷰카드행.
// 자동 무효화는 config.contradiction_auto=true opt-in에서만.
test("contradiction defaults to review queue, never auto-invalidates", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nightmerge-policy-"));
  const store = new Store(home);
  const cfg = { default_scope: "person" };
  const a = remember(store, { claim: "정책 테스트: 포트는 7001이다", scope: "project:p" }, cfg);
  const b = remember(store, { claim: "정책 테스트: 포트는 7002로 변경되었다", scope: "project:p" }, cfg);

  const result = applyJudgments(store, [{
    pair_id: `${a.id}:${b.id}`,
    verdict: "contradiction",
    confidence: 0.95,
    newer: "b",
    reason: "포트 변경",
  }]); // config 미전달 = 제품 기본값

  assert.equal(result.applied, 0);
  assert.equal(result.queued, 1);
  assert.equal(store.getFact(a.id).status, STATUS.ACTIVE); // 무효화 안 됨
  const queue = fs.readFileSync(path.join(home, "review", "queue.jsonl"), "utf8");
  assert.match(queue, /contradiction/);
  store.close();
});
