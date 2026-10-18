const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const g = fs.readFileSync(__dirname + "/../graph.js", "utf8");
const h = fs.readFileSync(__dirname + "/../os.html", "utf8");

test("graph.js: KM_DESVIO_PCT = 15", () => {
  assert.match(g, /KM_DESVIO_PCT:\s*\{\s*valor:\s*15\b/);
  assert.doesNotMatch(g, /KM_DESVIO_PCT:\s*\{\s*valor:\s*20\b/);
});

test("os.html: regra via KmDesvio atrás do flag", () => {
  assert.match(h, /KM_DESVIO_PCT_DEFAULT\s*=\s*15\s*;/);
  assert.match(h, /<script src="km-desvio\.js"><\/script>/);
  assert.match(h, /KmDesvio\.avaliar\(/);
  assert.match(h, /KmDesvio\.aplicarNosCampos\(/);
  assert.match(h, /KM_VALIDACAO_DESVIO\s*=\s*\{\s*ativa:\s*false/);
  assert.ok(!h.includes("Math.abs(campos.KM_Final"));
  assert.doesNotMatch(h, /20%/);
  assert.doesNotMatch(h, /default 20/);
  assert.match(h, /id="eKM_Justificativa"/);
});

test("os.html: justificativa nunca bloqueia", () => {
  assert.doesNotMatch(h, /return[^;\n]*eKM_Justificativa/);
  assert.doesNotMatch(h, /if\s*\([^)]*eKM_Justificativa[^)]*\)\s*return/);
  assert.match(h, /anexarJustificativa\(/);
});
