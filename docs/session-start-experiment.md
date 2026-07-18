# SessionStart Scoped Index — 72h Switchback Experiment

## Privacy Notice

When the SessionStart hook is active, a compact index of your saved memory topics
(scope-filtered to the current project, showing only fact ID prefixes and dates —
not full claim content) is injected into the model's context at session start.

**This means topic summaries are sent to the model provider (Anthropic) as part of
the conversation context.** No claims from other projects or personal-scope memories
are included.

You can disable this at any time:
```bash
nautli session-start uninstall
```

Or in `~/.claude/settings.json`, remove the `SessionStart` hook entry containing
`session-start-hook`.

## Experiment Design

**Goal:** Determine if auto-injecting a scoped memory index increases useful memory
consumption (model actually uses recall and the result helps the user) compared to
relying on spontaneous recall calls.

**Mechanism:** HMAC(install_salt, session_id) % 2 assigns each session to:
- **Arm 0 (control):** No index injected. Event logged for eligibility tracking.
- **Arm 1 (treatment):** Index injected with "recall하라" prompt. Event logged.

Resumed sessions retain their original arm assignment (HMAC is deterministic).

## Pre-Decision Rules

| Condition | Decision |
|-----------|----------|
| Treatment useful_consumption >= 3 absolute | **PROCEED** — enable default ON for new installs |
| Call rate increases but useful_consumption flat | **TWEAK** — revise copy/retrieval before enabling |
| Any wrong-scope (cross-project or person) leak in treatment | **HOLD** — default ON blocked until fixed |
| Insufficient data (< 72h or < 5 eligible sessions per arm) | **CONTINUE** — keep running |

**Not computed from this experiment:** token cost savings, latency impact.

## Commands

```bash
# Install the hook
nautli session-start install

# Check status
nautli session-start status

# Remove the hook
nautli session-start uninstall

# View experiment judgment (after collecting data)
nautli session-start-judgment

# Filter to events since a date
nautli session-start-judgment --since 2026-07-18
```

## Event Schema

Logged to `~/.nautli/events/YYYY-MM.jsonl`:
```json
{
  "ev": "session_start.index",
  "session_id": "...",
  "cwd": "...",
  "scope": "project:nautli",
  "experiment_arm": 0,
  "fact_count": 5,
  "tokens": 42,
  "at": "2026-07-18T10:00:00.000Z"
}
```
