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
