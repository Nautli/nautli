import { parentPort, workerData } from "node:worker_threads";
import { applyCard } from "../../src/core/review.js";
import { Store } from "../../src/core/store.js";

const gate = new Int32Array(workerData.gate);
parentPort.postMessage({ ready: true });
Atomics.wait(gate, 0, 0);
const store = new Store(workerData.home);
try {
  parentPort.postMessage({ result: applyCard(store, workerData.home, workerData.pairId, "keep_separate") });
} catch (error) {
  parentPort.postMessage({ error: { code: error?.code, message: error?.message } });
} finally {
  store.close();
}
