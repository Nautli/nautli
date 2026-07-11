import fs from "node:fs";
import path from "node:path";
import { ERR } from "./schema.js";

const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 60_000;
const RETRY_MS = 25;
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

function busyError() {
  const error = new Error("리뷰 큐가 사용 중이에요. 잠시 후 다시 시도해 주세요.");
  error.code = ERR.E_STORE_BUSY;
  return error;
}

export function withReviewLock(home, operation) {
  const reviewDirectory = path.join(home, "review");
  const lockDirectory = path.join(reviewDirectory, ".lock");
  fs.mkdirSync(reviewDirectory, { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      fs.mkdirSync(lockDirectory);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - fs.statSync(lockDirectory).mtimeMs;
        if (age > STALE_LOCK_MS) {
          fs.rmSync(lockDirectory, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError?.code === "ENOENT") continue;
        throw statError;
      }
      if (Date.now() >= deadline) throw busyError();
      Atomics.wait(waitBuffer, 0, 0, RETRY_MS);
    }
  }

  try {
    return operation();
  } finally {
    fs.rmSync(lockDirectory, { recursive: true, force: true });
  }
}
