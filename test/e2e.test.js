import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "src", "cli.js");
const mockJudge = path.join(root, "test", "fixtures", "mock-judge.js");

function fixedClock(date) {
  const epoch = Date.parse(date);
  const source = `const D=Date;globalThis.Date=class extends D{constructor(...a){super(...(a.length?a:[${epoch}]))}static now(){return ${epoch}}}`;
  return `--import=data:text/javascript,${encodeURIComponent(source)}`;
}

function runCli(home, args, date = "2025-04-01T12:00:00.000Z") {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      NIGHTMERGE_HOME: home,
      NIGHTMERGE_ALLOW_TEST_JUDGE: "1",
      NODE_OPTIONS: fixedClock(date),
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

test("CLI story survives daemon digestion and rebuild", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nightmerge-e2e-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  runCli(home, ["init"]);
  fs.writeFileSync(path.join(home, "config.json"), `${JSON.stringify({
    default_scope: "person",
    judge_cmd: [process.execPath, mockJudge],
    contradiction_auto: true, // e2e는 자동 무효화 경로까지 검증 (제품 기본값은 false)
  })}\n`, "utf8");

  runCli(home, ["remember", "서비스 포트는 3000", "--scope", "project:app"], "2025-01-01T12:00:00.000Z");
  runCli(home, ["remember", "문서 소유자는 민수", "--scope", "project:docs"], "2025-01-05T12:00:00.000Z");
  runCli(home, ["remember", "배포 전 테스트를 실행한다", "--scope", "procedure"], "2025-01-06T12:00:00.000Z");
  runCli(home, ["remember", "커피는 연하게 마신다", "--scope", "person"], "2025-01-07T12:00:00.000Z");
  runCli(home, ["remember", "서비스 포트는 4000", "--scope", "project:app"], "2025-02-01T12:00:00.000Z");

  const daemon = runCli(home, ["daemon-run"], "2025-03-01T12:00:00.000Z");
  assert.equal(daemon.applied, 1);

  const current = runCli(home, ["recall", "포트"], "2025-03-01T12:00:00.000Z");
  assert.match(current.briefing, /4000.*\(2\/1 기준, 확신 0\.7\)/);
  assert.doesNotMatch(current.briefing, /3000/);

  const past = runCli(home, ["recall", "포트", "--as-of", "2025-01-15"], "2025-03-01T12:00:00.000Z");
  assert.match(past.briefing, /3000.*\(1\/1 기준, 확신 0\.7\)/);
  assert.doesNotMatch(past.briefing, /4000/);

  runCli(home, ["rebuild"], "2025-03-01T12:00:00.000Z");
  const rebuilt = runCli(home, ["recall", "포트"], "2025-03-01T12:00:00.000Z");
  assert.deepEqual(rebuilt, current);

  const stats = runCli(home, ["stats"], "2025-03-01T12:00:00.000Z");
  assert.equal(stats.total, 5);
  assert.equal(stats.byStatus.active, 4);
  assert.equal(stats.byStatus.invalidated, 1);
});

test("daemon-run exits one when judging fails", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nightmerge-e2e-failed-daemon-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  runCli(home, ["init"]);
  fs.writeFileSync(path.join(home, "config.json"), `${JSON.stringify({
    default_scope: "person",
    judge_cmd: ["claude", "/tmp/forbidden-judge.js"],
  })}\n`, "utf8");
  runCli(home, ["remember", "실패 판정 서비스 포트는 3000", "--scope", "project:failed-daemon"]);
  runCli(home, ["remember", "실패 판정 서비스 포트는 4000", "--scope", "project:failed-daemon"]);
  const result = spawnSync(process.execPath, [cli, "daemon-run"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NIGHTMERGE_HOME: home },
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).ok, false);
});
