const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const K = require("../km-desvio.js");

test("KM_Ref ausente/0/negativo/NaN não avalia", () => {
  for (const ref of [undefined, null, "", 0, -5, NaN, "abc"]) {
    const r = K.avaliar(0, 100, ref, 15);
    assert.strictEqual(r.avaliado, false);
    assert.strictEqual(r.alerta, false);
    assert.strictEqual(r.exigeJustificativa, false);
    assert.strictEqual(r.bloqueia, undefined);
  }
});
test("70 com ref 61 (14,75%) sem alerta", () => {
  const r = K.avaliar(100, 170, 61, 15);
  assert.ok(Math.abs(r.desvioPct - 14.75) < 0.01);
  assert.strictEqual(r.alerta, false);
});
test("exatamente 15% sem alerta", () => {
  const r = K.avaliar(0, 115, 100, 15);
  assert.strictEqual(r.desvioPct, 15);
  assert.strictEqual(r.alerta, false);
  assert.strictEqual(r.exigeJustificativa, false);
});
test("70 com ref 60 (16,67%) alerta e exige justificativa", () => {
  const r = K.avaliar(0, 70, 60, 15);
  assert.ok(Math.abs(r.desvioPct - 16.67) < 0.01);
  assert.strictEqual(r.alerta, true);
  assert.strictEqual(r.exigeJustificativa, true);
});
test("abaixo da ref: desvio negativo sem alerta", () => {
  const r = K.avaliar(0, 20, 100, 15);
  assert.strictEqual(r.desvioPct, -80);
  assert.strictEqual(r.alerta, false);
});
test("limiar parametrizável", () => {
  assert.strictEqual(K.avaliar(0, 112, 100, 10).alerta, true);
  assert.strictEqual(K.avaliar(0, 110, 100, 10).alerta, false);
});
test("nunca indica bloqueio", () => {
  const r = K.avaliar(0, 1000, 10, 15);
  assert.strictEqual(r.alerta, true);
  assert.ok(!Object.keys(r).some(k => /bloque/i.test(k)));
});
test("fallback do limiar é 15 e sem limiar usa o fallback", () => {
  assert.strictEqual(K.LIMIAR_PADRAO_PCT, 15);
  assert.strictEqual(K.avaliar(0, 116, 100).alerta, true);
  assert.strictEqual(K.avaliar(0, 115, 100, undefined).alerta, false);
});
test("os.html e graph.js usam a mesma constante; sem limiar 30/50 km", () => {
  const root = path.join(__dirname, "..");
  const os = fs.readFileSync(path.join(root, "os.html"), "utf8");
  const g = fs.readFileSync(path.join(root, "graph.js"), "utf8");
  assert.match(os, /KmDesvio\.LIMIAR_PADRAO_PCT/);
  assert.match(g, /KM_DESVIO_PCT:\s*\{ valor: \(typeof KmDesvio[^}]*LIMIAR_PADRAO_PCT/);
  assert.match(os, /<script src="km-desvio\.js"><\/script>/);
  const src = fs.readFileSync(path.join(root, "km-desvio.js"), "utf8");
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /(?<![\d.])(30|50)(?![\d])/);
});
