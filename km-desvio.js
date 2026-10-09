// km-desvio.js — regra de divergência de KM (decisão do dono, OS-005).
// Função pura, carregável no navegador (global KmDesvio) e no Node (require).
//   KM_Rodado = KM_Final - KM_Inicial
//   Desvio_Percentual = ((KM_Rodado - KM_Ref) / KM_Ref) * 100  (com sinal)
// Nunca bloqueia o salvamento: acima do limiar só alerta e exige justificativa.
// KM_Ref precisa usar a MESMA base do hodômetro (ida/volta) de KM_Rodado.
var KmDesvio = (function () {
  const LIMIAR_PADRAO_PCT = 15; // fallback de KM_DESVIO_PCT (Politicas_Operacionais_Versoes)

  function avaliar(kmInicial, kmFinal, kmRef, limiarPct) {
    const nulo = { avaliado: false, kmRodado: null, desvioPct: null, alerta: false, exigeJustificativa: false };
    const num = v => (v === null || v === undefined || v === "" || typeof v === "boolean") ? NaN : Number(v);
    const ini = num(kmInicial), fim = num(kmFinal), ref = num(kmRef);
    if (!isFinite(ini) || !isFinite(fim) || !isFinite(ref) || ref <= 0) return nulo;
    const lim = (isFinite(num(limiarPct)) && num(limiarPct) > 0) ? num(limiarPct) : LIMIAR_PADRAO_PCT;
    const kmRodado = fim - ini;
    const desvioPct = ((kmRodado - ref) / ref) * 100;
    const acima = desvioPct > lim;
    return { avaliado: true, kmRodado: kmRodado, desvioPct: desvioPct, alerta: acima, exigeJustificativa: acima };
  }

  return { LIMIAR_PADRAO_PCT: LIMIAR_PADRAO_PCT, avaliar: avaliar };
})();
if (typeof module !== "undefined" && module.exports) module.exports = KmDesvio;
