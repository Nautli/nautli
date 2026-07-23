import test from "node:test";
import assert from "node:assert/strict";
import { STRINGS, makeT, resolveLocale } from "../src/i18n/strings.js";

test("resolveLocale defaults to English", () => {
  assert.equal(resolveLocale({}), "en");
  assert.equal(resolveLocale({ LANG: "en_US.UTF-8" }), "en");
});

test("resolveLocale detects Korean from LC_ALL or LANG", () => {
  assert.equal(resolveLocale({ LC_ALL: "ko_KR.UTF-8", LANG: "en_US.UTF-8" }), "ko");
  assert.equal(resolveLocale({ LANG: "ko-KR" }), "ko");
});

test("resolveLocale gives NAUTLI_LANG priority", () => {
  assert.equal(resolveLocale({ NAUTLI_LANG: "en", LC_ALL: "ko_KR.UTF-8" }), "en");
  assert.equal(resolveLocale({ NAUTLI_LANG: "ko", LC_ALL: "en_US.UTF-8" }), "ko");
});

test("resolveLocale detects Japanese from env or NAUTLI_LANG", () => {
  assert.equal(resolveLocale({ LANG: "ja_JP.UTF-8" }), "ja");
  assert.equal(resolveLocale({ LC_ALL: "ja-JP", LANG: "en_US.UTF-8" }), "ja");
  assert.equal(resolveLocale({ NAUTLI_LANG: "ja", LC_ALL: "en_US.UTF-8" }), "ja");
});

// TASK-082: CLI locale additions must not silently fall back to English or lose interpolation variables.
test("every CLI Japanese string is explicit and keeps English placeholders", () => {
  const placeholders = (value) => [...String(value).matchAll(/\{([A-Za-z0-9_]+)\}/gu)]
    .map((match) => match[1])
    .sort();

  for (const [key, entry] of Object.entries(STRINGS)) {
    if (!key.startsWith("cli.")) continue;
    assert.equal(typeof entry.ja, "string", `${key} must not fall back to en for ja`);
    assert.deepEqual(placeholders(entry.ja), placeholders(entry.en), `${key} placeholder parity`);
  }
});

test("Japanese CLI translator never resolves through the English fallback", () => {
  const t = makeT("ja");
  for (const [key, entry] of Object.entries(STRINGS)) {
    if (!key.startsWith("cli.")) continue;
    assert.equal(t(key), entry.ja, `${key} should resolve its Japanese template`);
  }
});
