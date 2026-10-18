// Regra de desvio de KM — módulo puro (sem DOM, sem rede).
(function () {
  function num(v) {
    if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  function avaliar(kmInicial, kmFinal, kmRef, limiarPct) {
    const ini = num(kmInicial), fim = num(kmFinal), ref = num(kmRef);
    if (ini === null || fim === null || ref === null || ref <= 0) {
      return { avaliado: false, desvioPct: null, alerta: null };
    }
    const desvio = Math.round(((fim - ini - ref) / ref) * 100 * 100) / 100;
    return { avaliado: true, desvioPct: desvio, alerta: desvio > limiarPct };
  }

  function aplicarNosCampos(campos, avaliacao) {
    const out = Object.assign({}, campos);
    if (avaliacao && avaliacao.avaliado) {
      out.KM_Divergencia_Pct = avaliacao.desvioPct;
      out.Alerta_KM_Divergente = avaliacao.alerta;
    }
    return out;
  }

  function anexarJustificativa(obsAtual, justificativa, desvioPct, dataISO) {
    const base = obsAtual == null ? "" : String(obsAtual);
    const j = justificativa == null ? "" : String(justificativa).trim();
    if (!j) return base;
    const d = String(dataISO);
    const data = d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4);
    const pct = Number(desvioPct).toFixed(1).replace(".", ",");
    const linha = "[Desvio KM " + pct + "% em " + data + "] " + j;
    return base ? base + "\n" + linha : linha;
  }

  const KmDesvio = { avaliar, aplicarNosCampos, anexarJustificativa };
  if (typeof window !== "undefined") window.KmDesvio = KmDesvio;
  if (typeof module !== "undefined" && module.exports) module.exports = KmDesvio;
})();
