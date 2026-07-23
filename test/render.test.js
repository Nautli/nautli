import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { remember } from "../src/core/gate.js";
import { renderViews } from "../src/daemon/render.js";
import { Store } from "../src/core/store.js";

const config = { default_scope: "person" };

test("korean project scopes render to distinct view files", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-render-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  remember(store, { claim: "임장서비스는 공매를 먼저 다룬다", scope: "project:임장서비스" }, config);
  remember(store, { claim: "포켓몬카드앱 스캔이 최우선 게이트다", scope: "project:포켓몬카드앱" }, config);
  remember(store, { claim: "영문 프로젝트 기준선 확인용", scope: "project:bridgr" }, config);

  const result = renderViews(store, home);
  const names = result.files.map((file) => path.basename(file));

  // 한글 스코프가 ASCII 슬러그화로 전부 project.md 하나에 충돌·유실됐던 실사고(2026-07-17) 회귀 방지
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes("project-임장서비스.md"));
  assert.ok(names.includes("project-포켓몬카드앱.md"));
  assert.ok(names.includes("project-bridgr.md"));
  assert.ok(!names.includes("project.md"));
  assert.match(
    fs.readFileSync(path.join(home, "views", "project-임장서비스.md"), "utf8"),
    /임장서비스는 공매를 먼저 다룬다/u,
  );
});

// TASK-FIX-B12 (H-4): a Backlinks section for a project view must never print a claim
// from another scope (e.g. a private person fact) reached through a cross-scope edge.
test("TASK-FIX-B12 Backlinks omit cross-scope edges and keep same-scope edges", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-render-xscope-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  const projA = remember(store, { claim: "배포 포트는 3000", scope: "project:alpha", confidence: 0.9 }, config);
  const projB = remember(store, { claim: "회고 회의는 금요일", scope: "project:alpha", confidence: 0.9 }, config);
  const personSecret = remember(store, { claim: "커피는 연하게 마신다", scope: "person", confidence: 0.9 }, config);

  // Same-scope edge (project<->project) should render; cross-scope edge (project<->person) must not.
  store.upsertEdge({ a_id: projA.id, b_id: projB.id, kind: "related", confidence: 0.9, source: "judge" });
  store.upsertEdge({ a_id: projA.id, b_id: personSecret.id, kind: "related", confidence: 0.9, source: "judge" });

  renderViews(store, home);
  const projectView = fs.readFileSync(path.join(home, "views", "project-alpha.md"), "utf8");

  assert.match(projectView, /## Backlinks/u);
  assert.match(projectView, /회고 회의는 금요일/u); // same-scope edge rendered
  assert.doesNotMatch(projectView, /커피는 연하게 마신다/u); // cross-scope person claim NOT leaked
});
