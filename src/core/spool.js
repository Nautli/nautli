import fs from "node:fs";
import path from "node:path";

export const DEFAULT_PATROL = Object.freeze({
  settle_ms: 300_000,
  max_wait_ms: 900_000,
});

function spoolDirectory(home) {
  return path.join(home, "daemon", "spool");
}

function markerNames(directory) {
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".marker"));
}

export function touchSpool(home) {
  try {
    const directory = spoolDirectory(home);
    fs.mkdirSync(directory, { recursive: true });
    const random = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
    fs.writeFileSync(path.join(directory, `${Date.now()}-${random}.marker`), "", {
      flag: "wx",
    });
  } catch {
    // remember의 성공 여부는 순찰 스풀 I/O에 의존하지 않는다.
  }
}

export function readSpool(home) {
  try {
    const directory = spoolDirectory(home);
    const mtimes = markerNames(directory)
      .map((name) => fs.statSync(path.join(directory, name)).mtimeMs);
    return {
      count: mtimes.length,
      newest_at: mtimes.length === 0 ? null : Math.max(...mtimes),
    };
  } catch {
    return { count: 0, newest_at: null };
  }
}

export function consumeSpool(home, beforeMs) {
  let removed = 0;
  try {
    const directory = spoolDirectory(home);
    for (const name of markerNames(directory)) {
      const file = path.join(directory, name);
      try {
        if (fs.statSync(file).mtimeMs <= beforeMs) {
          fs.unlinkSync(file);
          removed += 1;
        }
      } catch {
        // 다른 프로세스가 먼저 소비했거나 개별 marker가 손상된 경우는 무시한다.
      }
    }
  } catch {
    // 스풀 조회/삭제 실패는 다음 순찰에서 다시 시도한다.
  }
  return removed;
}
