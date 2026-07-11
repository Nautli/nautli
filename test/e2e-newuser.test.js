import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyCard, listCards } from "../src/core/review.js";
import { STATUS } from "../src/core/schema.js";
import { Store } from "../src/core/store.js";
import { initStore, runDigestOnce, seedSampleFacts } from "../src/onboard/setup.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mockJudge = path.join(root, "test", "fixtures", "mock-judge.js");

test("new user reaches a review card and applies newer_wins without a real Claude call", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nightmerge-newuser-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  initStore(home);
  fs.writeFileSync(path.join(home, "config.json"), `${JSON.stringify({
    default_scope: "person",
    judge_cmd: [process.execPath, mockJudge],
  })}\n`, "utf8");
  const seeded = seedSampleFacts(home);
  assert.equal(seeded.seeded, 4);

  const digest = await runDigestOnce(home);
  assert.equal(digest.ok, true);
  const contradiction = listCards(home).find((card) => card.verdict === "contradiction");
  assert.ok(contradiction);

  const store = new Store(home);
  try {
    const [aId, bId] = contradiction.pair_id.split(":");
    const newerId = contradiction.newer === "a" ? aId : bId;
    const olderId = newerId === aId ? bId : aId;
    assert.equal(applyCard(store, home, contradiction.pair_id, "newer_wins").ok, true);
    assert.equal(store.getFact(newerId).status, STATUS.ACTIVE);
    assert.equal(store.getFact(olderId).status, STATUS.INVALIDATED);
  } finally {
    store.close();
  }
});
