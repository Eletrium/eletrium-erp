// crm-observabilidade.js — classificação de frescor para espelhos/automação CRM.
// NÃO descobre a fonte do heartbeat e NÃO inventa limiar. Recebe ambos já
// resolvidos pelo consumidor e falha fechado quando qualquer um estiver ausente.
window.CRMObservabilidade = (function(){
  "use strict";

  const ESTADOS = Object.freeze({
    FRESCO: "FRESCO",
    STALE: "STALE",
    NAO_VERIFICAVEL: "NAO_VERIFICAVEL"
  });

  function numeroPositivo(v){
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function dataValida(v){
    if (v == null || v === "") return null;
    const d = v instanceof Date ? new Date(v.getTime()) : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function avaliarFrescor(atualizadoEm, limiarHoras, agora){
    const ts = dataValida(atualizadoEm);
    const limite = numeroPositivo(limiarHoras);
    const now = dataValida(agora || new Date());
    if (!ts) return { estado: ESTADOS.NAO_VERIFICAVEL, motivo: "heartbeat ausente ou inválido", atualizadoEm: null, idadeHoras: null, limiarHoras: limite };
    if (!limite) return { estado: ESTADOS.NAO_VERIFICAVEL, motivo: "limiar de staleness ausente ou inválido", atualizadoEm: ts.toISOString(), idadeHoras: null, limiarHoras: null };
    if (!now) return { estado: ESTADOS.NAO_VERIFICAVEL, motivo: "relógio de referência inválido", atualizadoEm: ts.toISOString(), idadeHoras: null, limiarHoras: limite };
    const idadeMs = now.getTime() - ts.getTime();
    // timestamp futuro relevante indica problema de relógio/dado; não declarar fresco.
    if (idadeMs < -5 * 60 * 1000) return { estado: ESTADOS.NAO_VERIFICAVEL, motivo: "heartbeat está no futuro", atualizadoEm: ts.toISOString(), idadeHoras: idadeMs / 3600000, limiarHoras: limite };
    const idadeHoras = Math.max(0, idadeMs / 3600000);
    return {
      estado: idadeHoras <= limite ? ESTADOS.FRESCO : ESTADOS.STALE,
      motivo: idadeHoras <= limite ? "heartbeat dentro do limiar" : "heartbeat ultrapassou o limiar",
      atualizadoEm: ts.toISOString(), idadeHoras, limiarHoras: limite
    };
  }

  function texto(r){
    if (!r || r.estado === ESTADOS.NAO_VERIFICAVEL) return "Frescor não verificável" + (r && r.motivo ? " — " + r.motivo : "");
    const idade = Number.isFinite(r.idadeHoras) ? r.idadeHoras.toFixed(1).replace(".", ",") + " h" : "—";
    if (r.estado === ESTADOS.FRESCO) return "Espelho fresco — atualização há " + idade;
    return "Espelho desatualizado — última atualização há " + idade + " (limiar " + r.limiarHoras + " h)";
  }

  function classe(r){
    if (!r || r.estado === ESTADOS.NAO_VERIFICAVEL) return "warn";
    return r.estado === ESTADOS.FRESCO ? "ok" : "err";
  }

  function assertRegras(){
    const falhas=[];let total=0;const ok=(c,m)=>{total++;if(!c)falhas.push(m)};
    const now=new Date("2026-08-21T18:00:00-03:00");
    ok(avaliarFrescor("2026-08-21T17:00:00-03:00",24,now).estado===ESTADOS.FRESCO,"1h com limiar 24h deve ser fresco");
    ok(avaliarFrescor("2026-08-20T16:00:00-03:00",24,now).estado===ESTADOS.STALE,"26h com limiar 24h deve ser stale");
    ok(avaliarFrescor(null,24,now).estado===ESTADOS.NAO_VERIFICAVEL,"sem heartbeat nunca pode declarar fresco");
    ok(avaliarFrescor("2026-08-21T17:00:00-03:00",null,now).estado===ESTADOS.NAO_VERIFICAVEL,"sem limiar nunca pode declarar fresco");
    ok(avaliarFrescor("2026-08-22T18:00:00-03:00",24,now).estado===ESTADOS.NAO_VERIFICAVEL,"heartbeat futuro relevante deve ser não verificável");
    const r={ok:!falhas.length,total,falhas};console.log("CRMObservabilidade.assertRegras:",JSON.stringify(r,null,2));return r;
  }

  return { ESTADOS, avaliarFrescor, texto, classe, assertRegras };
})();
