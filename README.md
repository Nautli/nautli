# nautli

**Every AI memory tool stores. nautli digests.**

One local brain for all your AI agents. Claude Code, Cursor, and other MCP clients share a single local memory. While you sleep, a digestion daemon merges duplicates, turns contradictions into review cards, and forgets junk. The source of truth is plain files on your disk, not someone else's server.

```text
You, in Claude Code:     "Remember: our API runs on port 4000."
You, in Cursor, later:   "What port does our API use?"
Cursor:                  4000  (recalled from the same local brain)
```

[한국어 문서: README.ko.md](README.ko.md)

## Install

```bash
npx nautli dashboard
```

The dashboard opens on 127.0.0.1 only and walks you through everything:

1. **Memory checkup**: scans the notes you already have (an Obsidian vault, CLAUDE.md, agent memory files) and shows a health score with real duplicates, contradictions, and stale facts from your own data. The preview scans up to 40 notes and typically takes around 10 minutes. Import what it found in one click, or start clean.
2. **Connect Claude Code**: one-click MCP registration (remember / recall / briefing tools).
3. **Habit instructions**: adds one block to your CLAUDE.md so the AI actually uses its memory.
4. **Nightly digestion daemon**: every night at 3:30, duplicates get merged and contradictions become review cards. Fully removable with one button.

### Requirements, honestly

| | |
|---|---|
| Node.js | 20 or newer |
| Claude Code CLI | installed and logged in. Duplicate and contradiction judgments run through your own Claude subscription |
| python3 | only needed for the memory checkup step |
| OS | macOS for the automatic nightly daemon (launchctl). The core CLI and MCP server run anywhere Node runs; on other platforms run `npx nautli daemon-run` yourself or via cron |

better-sqlite3 is a native module. Most platforms download a prebuilt binary; unusual platform and Node combinations fall back to compiling, which needs python3 and a C++ toolchain.

### Which AI tools work today

| Tool | Status |
|---|---|
| Claude Code | automatic, one-click registration |
| Cursor | manual, copy the provided mcp.json snippet |
| Other MCP clients | the stdio MCP server is standard, but untested beyond the two above |
| ChatGPT / Gemini apps | not yet supported |

### Let a coding agent install it for you

Paste this to Claude Code or any coding agent; the whole flow is non-interactive:

```bash
npx nautli setup --yes    # storage + MCP registration + instructions + nightly daemon + one digest run
npx nautli doctor         # verify the install
```

Global install, if you prefer: `npm i -g nautli`, then `nautli dashboard`. Contributors: `git clone https://github.com/nautli/nautli.git && cd nautli && npm install && node src/cli.js dashboard`.

## Why another memory tool

Memory that only grows turns into a junk drawer: three copies of every fact, two of them out of date, and your AI picks one at random. Most memory tools store and retrieve. nautli treats memory as something that must be digested:

- **Digestion, not accumulation.** A nightly daemon merges duplicates and resolves what it can safely.
- **Review cards, not silent edits.** Ambiguous judgments are never auto-applied. Contradictions become morning cards you answer with one click, and your answer becomes a new fact.
- **Non-lossy by design.** Facts are never deleted. Superseded and invalidated facts are archived with their full history, and `rebuild` restores the index from your files at any time.
- **Bi-temporal facts.** Every fact knows when it was true and when it was recorded, so "we moved from port 3000 to 4000" is history, not a conflict.
- **Local first.** Your memory is files in `~/.nautli/`. Switch AI tools, keep your brain.

## Measured quality so far

Numbers below are from our internal evaluation: a 4,000+ atom run on our own vault plus holdout runs on three external testers' vaults. The labeled eval set and methodology write-up will be published in this repo; until then, treat these as author-reported.

- Wrong auto-merges: 0 out of 24 auto-merges observed (small sample, so read this as "0 observed", not "impossible")
- Contradiction detection recall: 100% on our labeled set
- Wrong auto-applied actions: 0, because anything ambiguous goes to a review card by policy
- The honest weak spot: junk filtering. Single digit junk on our own data, far worse on external vaults in early tests. A three-stage filter is in progress, and numbers will be published either way

## Data boundary

- Memories, event logs, and reports are local files under `~/.nautli/`. Nothing is uploaded to any server of ours; we do not have one.
- The only text that leaves your machine is judgment prompts (duplicate and contradiction checks) sent through your own Claude subscription to Anthropic.
- Facts are never DELETEd, only soft-archived. `npx nautli rebuild` reconstructs everything from the source files.

## CLI

```bash
npx nautli init                                              # create ~/.nautli
npx nautli remember "our API port is 4000" --scope project:myapp
npx nautli recall "port" --scope project:myapp
npx nautli daemon-run                                        # run one digestion manually
npx nautli rebuild                                           # rebuild the index from source files
```

Manual MCP registration:

```bash
claude mcp add -s user nautli -- npx nautli mcp
```

## Architecture

`src/core` storage, write gate, recall / `src/mcp` stdio server / `src/cli.js` / `src/daemon` pair, judge, apply, report, render / `src/dashboard` local dashboard / `src/onboard` setup and checkup. Full spec: [SPEC.md](SPEC.md).

Invariants (violations are bugs, pinned by tests): user files are the source of truth (rebuild round-trip) / no DELETE on facts / single-pass writes, cleanup only in the daemon / core works even if the daemon dies / no promotion injection into recall / when in doubt, no-op (asymmetric cost of a wrong merge).

## Known limits

- t_valid is date-granular; same-day contradictions are judged from recorded time and context
- LLM judge nondeterminism is defended four ways: isolated cwd, format examples, zero-parse retry, failed batches become no-ops
- No embeddings yet (FTS prefix search only), planned for v1.1
- Merge direction is t_valid based; if a subset fact is newer than its superset, the superset can be folded. Fix planned via a judge keep field
