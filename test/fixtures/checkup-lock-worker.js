// TASK-002
import fs from "node:fs";
import path from "node:path";
import { startCheckup, readCurrent } from "../../src/onboard/checkup.js";

// TASK-002
const { CHECKUP_HOME: home, CHECKUP_USER_HOME: userHome, CHECKUP_VAULT: vault, CHECKUP_GATE: gate, CHECKUP_READY: ready, CHECKUP_TOKEN: token } = process.env;
fs.appendFileSync(ready, `${token}\n`);

// TASK-002
const waitForGate = setInterval(() => {
  if (!fs.existsSync(gate)) return;
  clearInterval(waitForGate);
  try {
    const result = startCheckup(home, vault, {
      userHome,
      spawner: (_command, _args, options) => {
        // TASK-002
        fs.appendFileSync(path.join(home, "checkup", "spawns"), `${token}\n`);
        fs.writeSync(options.stdio[1], `${token}\n`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
        return { pid: process.pid, unref() {}, on() {} };
      },
    });
    const current = readCurrent(home);
    fs.mkdirSync(current.run_dir, { recursive: true });
    fs.writeFileSync(path.join(current.run_dir, "winner"), token);
    report({ token, result, pid: process.pid });
  } catch (error) {
    report({ token, error: error?.code ?? error?.message });
  }
}, 5);

// TASK-002
function report(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
