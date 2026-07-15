import test from "node:test";
import assert from "node:assert/strict";
import { resolveLocale } from "../src/i18n/strings.js";

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
