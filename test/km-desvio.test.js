const test = require("node:test");
const assert = require("node:assert");
const K = require("../km-desvio.js");

test("avaliar: limites", () => {
  assert.deepStrictEqual(K.avaliar(1000, 1115, 100, 15), { avaliado: true, desvioPct: 15, alerta: false });
  assert.deepStrictEqual(K.avaliar(0, 115.5, 100, 15), { avaliado: true, desvioPct: 15.5, alerta: true });
  assert.deepStrictEqual(K.avaliar(1000, 1116, 100, 15), { avaliado: true, desvioPct: 16, alerta: true });
  assert.deepStrictEqual(K.avaliar(1000, 1114, 100, 15), { avaliado: true, desvioPct: 14, alerta: false });
  assert.deepStrictEqual(K.avaliar(1000, 1050, 100, 15), { avaliado: true, desvioPct: -50, alerta: false });
  assert.deepStrictEqual(K.avaliar(0, 33.333, 30, 15), { avaliado: true, desvioPct: 11.11, alerta: false });
});

test("avaliar: referência ou km inválidos", () => {
  const nao = { avaliado: false, desvioPct: null, alerta: null };
  for (const ref of [0, -10, null, undefined, "abc", ""]) assert.deepStrictEqual(K.avaliar(1000, 1200, ref, 15), nao);
  assert.deepStrictEqual(K.avaliar(null, 1200, 100, 15), nao);
  assert.deepStrictEqual(K.avaliar(1000, "x", 100, 15), nao);
});

test("aplicarNosCampos", () => {
  const a = K.aplicarNosCampos({ KM_Final: 1116 }, K.avaliar(1000, 1116, 100, 15));
  assert.deepStrictEqual(a, { KM_Final: 1116, KM_Divergencia_Pct: 16, Alerta_KM_Divergente: true });
  const b = K.aplicarNosCampos({ KM_Final: 1114 }, K.avaliar(1000, 1114, 100, 15));
  assert.deepStrictEqual(b, { KM_Final: 1114, KM_Divergencia_Pct: 14, Alerta_KM_Divergente: false });
  const orig = { KM_Final: 1200 };
  const c = K.aplicarNosCampos(orig, K.avaliar(1000, 1200, 0, 15));
  assert.deepStrictEqual(c, { KM_Final: 1200 });
  assert.notStrictEqual(c, orig);
  assert.ok(!("Alerta_KM_Divergente" in c) && !("KM_Divergencia_Pct" in c));
});

test("anexarJustificativa", () => {
  assert.strictEqual(K.anexarJustificativa("Obs antiga", "  Transito intenso ", 23.4, "2026-10-18"),
    "Obs antiga\n[Desvio KM 23,4% em 18/10/2026] Transito intenso");
  assert.strictEqual(K.anexarJustificativa("", "Chuva", 20, "2026-01-05"), "[Desvio KM 20,0% em 05/01/2026] Chuva");
  assert.strictEqual(K.anexarJustificativa(null, "Chuva", 20, "2026-01-05"), "[Desvio KM 20,0% em 05/01/2026] Chuva");
  assert.strictEqual(K.anexarJustificativa("Obs antiga", "", 23.4, "2026-10-18"), "Obs antiga");
  assert.strictEqual(K.anexarJustificativa("Obs antiga", null, 23.4, "2026-10-18"), "Obs antiga");
  assert.strictEqual(K.anexarJustificativa("Obs antiga", "   ", 23.4, "2026-10-18"), "Obs antiga");
  assert.strictEqual(K.anexarJustificativa(undefined, null, 1, "2026-10-18"), "");
});
