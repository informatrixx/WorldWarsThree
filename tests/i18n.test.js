import test from "node:test";
import assert from "node:assert/strict";

import { translate, translations } from "../src/i18n.js";

test("German and English expose the same translation keys", () => {
  assert.deepEqual(Object.keys(translations.de).sort(), Object.keys(translations.en).sort());
});

test("translation variables are interpolated without leaving placeholders", () => {
  assert.equal(translate("de", "round", { round: 7 }), "Runde 7");
  assert.equal(translate("en", "units", { count: 4 }), "4 units");
});
