import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../src/core/store.js";
import { remember } from "../src/core/gate.js";
import { ingest, validateIngestPath } from "../src/core/ingest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mockExtract = path.join(root, "test", "fixtures", "mock-ingest-extract.js");
const mockJudge = path.join(root, "test", "fixtures", "mock-judge.js");
process.env.NAUTLI_ALLOW_TEST_JUDGE = "1";
process.env.NAUTLI_JUDGE_RETRY_DELAY_MS = "1";

const config = {
  default_scope: "person",
  ingest_cmd: [process.execPath, mockExtract],
  judge_cmd: [process.execPath, mockJudge],
  triage_cmd: false,
};

function isolatedStore(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nautli-ingest-"));
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, store };
}

function writeDoc(home, name, body) {
  const file = path.join(home, name);
  fs.writeFileSync(file, body, "utf8");
  return file;
}

const SAMPLE = `# 프로젝트 노트
배포 절차 문서 정리가 필요하다
API 서버는 리전 A에 있다
로그는 매일 자정에 회전한다
캐시 TTL은 60초로 설정한다
`;

// TASK-015
test("ingest extracts 3+ facts and is idempotent on re-run", async (t) => {
  const { home, store } = isolatedStore(t);
  const doc = writeDoc(home, "notes.md", SAMPLE);

  const first = await ingest(store, doc, config);
  assert.equal(first.source, fs.realpathSync(doc));
  assert.ok(first.extracted >= 3, `extracted ${first.extracted}`);
  assert.ok(first.added >= 3, `added ${first.added}`);
  assert.equal(first.rejected, 0);

  const second = await ingest(store, doc, config);
  assert.equal(second.added, 0, "re-run adds nothing");
  assert.equal(second.duplicates, second.extracted);
});

// TASK-015
test("every atom flows through the remember gate with ingest provenance", async (t) => {
  const { home, store } = isolatedStore(t);
  const doc = writeDoc(home, "prov.md", "단일 사실 하나 저장됨\n");
  const realpath = fs.realpathSync(doc);

  await ingest(store, doc, config);
  const facts = store.query({ status: "active" }).filter((f) => f.claim === "단일 사실 하나 저장됨");
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0].provenance, { path: realpath, source: "ingest" });
});

// TASK-015
test("new facts pair against existing active facts and related verdicts create edges", async (t) => {
  const { home, store } = isolatedStore(t);
  // 기존 active fact — 같은 scope, doc 라인과 토큰을 공유해 FTS 매칭이 성립하게.
  const existing = remember(store, {
    claim: "배포 절차는 수동 승인 단계를 포함한다",
    scope: "project:ingest",
    confidence: 0.8,
  }, config);

  const doc = writeDoc(home, "edges.md", "배포 절차 문서 정리가 필요하다\n");
  const result = await ingest(store, doc, config);
  assert.ok(result.judged >= 1, `judged ${result.judged}`);

  const edges = store.listEdges([existing.id]);
  assert.ok(edges.length >= 1, "an edge was created for the related pair");
  assert.equal(edges[0].kind, "related");
  assert.equal(edges[0].source, "ingest");
});

// TASK-015
test("URL and PDF inputs are explicitly rejected", (t) => {
  const { store } = isolatedStore(t);
  assert.rejects(() => ingest(store, "https://example.com/doc.md", config),
    (e) => e.code === "E_INGEST_UNSUPPORTED");
  assert.rejects(() => ingest(store, "/tmp/whatever.pdf", config),
    (e) => e.code === "E_INGEST_UNSUPPORTED");
  assert.throws(() => validateIngestPath("/tmp/x.docx"), (e) => e.code === "E_INGEST_UNSUPPORTED");
  assert.throws(() => validateIngestPath("http://x.com/a.txt"), (e) => e.code === "E_INGEST_UNSUPPORTED");
});

// TASK-015
test("atom count is capped at 100", async (t) => {
  const { home, store } = isolatedStore(t);
  const body = Array.from({ length: 150 }, (_, i) => `사실 항목 번호 ${i}`).join("\n");
  const doc = writeDoc(home, "many.md", `${body}\n`);
  const result = await ingest(store, doc, config);
  assert.equal(result.extracted, 100);
});
