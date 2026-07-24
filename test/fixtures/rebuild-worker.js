// TASK-001: rebuild 크로스프로세스 락 테스트용 자식 프로세스 헬퍼.
// 역할(role)로 동작을 가른다 — holder/contender/marker-spammer.
// 조율은 파일 플래그로만 한다(동기 블로킹 구간이 IPC 이벤트루프를 막으므로).
import fs from "node:fs";
import path from "node:path";
import { Store } from "../../src/core/store.js";

// TASK-001
const [, , home, role, controlDir] = process.argv;
const sleeper = new Int32Array(new SharedArrayBuffer(4));
function sleepMs(ms) {
  Atomics.wait(sleeper, 0, 0, ms);
}
function report(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}
function lockPath() {
  return path.join(home, ".index-rebuild.lock");
}

// TASK-001: 락을 잡고 임계구역(리플레이)에 진입한 뒤, 형제가 충돌해 E_STORE_BUSY를
// 받을 때까지 임계구역을 유지하는 역할. 첫 replay 이벤트에서 진입을 알리고 대기한다.
if (role === "holder") {
  const store = new Store(home);
  const original = store.applyEvent.bind(store);
  let first = true;
  store.applyEvent = (evt) => {
    if (first) {
      first = false;
      fs.writeFileSync(path.join(controlDir, "entered"), String(process.pid));
      while (!fs.existsSync(path.join(controlDir, "proceed"))) sleepMs(20);
    }
    return original(evt);
  };
  try {
    store.rebuild();
    report({ entered: true });
  } catch (error) {
    report({ error: error?.code ?? error?.message });
  } finally {
    store.close();
  }
// TASK-001: holder가 임계구역에 진입한 뒤 rebuild()를 시도해 반드시 E_STORE_BUSY로 패배하는 역할.
} else if (role === "contender") {
  while (!fs.existsSync(path.join(controlDir, "entered"))) sleepMs(20);
  const store = new Store(home);
  try {
    store.rebuild();
    report({ entered: true });
  } catch (error) {
    report({ busy: error?.code === "E_STORE_BUSY", error: error?.code ?? error?.message });
  } finally {
    store.close();
  }
// TASK-001: 살아있는 락을 만들어 rebuildInProgress=true로 둔 뒤, append가 원자적 마커를
// 반복 기록하게 해 부모의 동시 읽기가 부분 JSON을 절대 관측하지 않음을 검증하게 한다.
} else if (role === "marker-spammer") {
  fs.writeFileSync(
    lockPath(),
    JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }),
    { mode: 0o600 },
  );
  const store = new Store(home);
  try {
    for (let i = 0; i < 400; i += 1) {
      store.appendEvent({ ev: "fact.added", type: "remember", source: "spam", fact: { id: `spam_${i}` } });
    }
    report({ wrote: 400 });
  } finally {
    store.close();
    fs.rmSync(lockPath(), { force: true });
  }
} else {
  report({ error: "unknown-role" });
  process.exit(1);
}
