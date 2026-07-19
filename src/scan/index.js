import { discover } from "./discover.js";
import { analyze } from "./analyze.js";
import { openReport, writeReport } from "./report.js";
import { ping } from "./ping.js";

export async function runScan({
  lang = "en",
  noOpen = false,
  noPing = false,
  cwd = process.cwd(),
  home,
  platform = process.platform,
} = {}) {
  const discovered = discover({ cwd, home, platform });
  const result = analyze(discovered, { lang });
  const pingResult = noPing ? null : await ping(result);
  const percentile = pingResult?.percentile;
  const reportFile = writeReport(result, { lang, percentile });
  if (!noOpen) openReport(reportFile, platform);
  return { result, reportFile, percentile };
}

export { discover } from "./discover.js";
export { analyze } from "./analyze.js";
export { buildPingPayload, buildSharePayload, ping } from "./ping.js";
export { openReport, renderReportHtml, writeReport } from "./report.js";
