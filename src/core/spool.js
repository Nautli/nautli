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
    const names = markerNames(directory);
    const mtimes = names.map((name) => fs.statSync(path.join(directory, name)).mtimeMs);
    return {
      count: names.length,
      newest_at: names.length === 0 ? null : Math.max(...mtimes),
      names,
    };
  } catch {
    return { count: 0, newest_at: null, names: [] };
  }
}

// 이름 스냅샷 기반 소비 — mtime vs 시계 비교는 가짜/역행 시계에서 미소비·과소비를
// 일으키므로(디지스트 직전 readSpool 스냅샷의 names만 정확히 지운다) 시계 비의존으로 처리.
export function consumeSpool(home, names) {
  let removed = 0;
  try {
    const directory = spoolDirectory(home);
    for (const name of names ?? []) {
      try {
        fs.unlinkSync(path.join(directory, name));
        removed += 1;
      } catch {
        // 다른 프로세스가 먼저 소비했거나 개별 marker가 손상된 경우는 무시한다.
      }
    }
  } catch {
    // 스풀 조회/삭제 실패는 다음 순찰에서 다시 시도한다.
  }
  return removed;
}
