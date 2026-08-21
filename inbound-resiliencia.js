// inbound-resiliencia.js — journal local do formulário público de Inbound.
// Não substitui a persistência server-side. Objetivo: registrar a intenção ANTES
// do POST, preservar um lead_intent_id estável para idempotência no Make e só
// remover do browser após ACK explícito.
window.InboundResiliencia = (function(){
  "use strict";
  const STORAGE_KEY = "eletrium_inbound_intents_v1";
  const MAX_ITENS = 50;

  const agoraIso = () => new Date().toISOString();
  const rid = () => {
    if (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return "lead-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,10);
  };

  function ler(storage){
    const s = storage || window.localStorage;
    try { const v = JSON.parse(s.getItem(STORAGE_KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch { return []; }
  }
  function gravar(itens, storage){
    const s = storage || window.localStorage;
    s.setItem(STORAGE_KEY, JSON.stringify((itens || []).slice(-MAX_ITENS)));
  }

  function novaIntencao(payload, id){
    const leadIntentId = id || rid();
    return {
      lead_intent_id: leadIntentId,
      criado_em: agoraIso(),
      atualizado_em: agoraIso(),
      status: "LOCAL_PENDING",
      tentativas: 0,
      ultimo_erro: null,
      payload: Object.assign({}, payload || {}, { lead_intent_id: leadIntentId })
    };
  }

  function registrar(payload, storage){
    const itens = ler(storage);
    const i = novaIntencao(payload);
    itens.push(i); gravar(itens, storage); return i;
  }

  function atualizar(id, patch, storage){
    const itens = ler(storage); const idx = itens.findIndex(x => x && x.lead_intent_id === id);
    if (idx < 0) return null;
    itens[idx] = Object.assign({}, itens[idx], patch || {}, { atualizado_em: agoraIso() });
    gravar(itens, storage); return itens[idx];
  }

  function concluir(id, ack, storage){
    return atualizar(id, { status:"ACKED", ack: ack || null, ultimo_erro:null }, storage);
  }

  function removerConcluidos(storage){
    const itens = ler(storage).filter(x => x && x.status !== "ACKED");
    gravar(itens, storage); return itens;
  }

  function pendentes(storage){ return ler(storage).filter(x => x && x.status !== "ACKED"); }

  function classificarHttp(status){
    const n = Number(status);
    if (n === 429 || n === 500 || n === 502 || n === 503 || n === 504) return { retryable:true, tipo:"transitorio" };
    if (n >= 400 && n < 500) return { retryable:false, tipo:"cliente" };
    return { retryable:false, tipo:"desconhecido" };
  }

  async function enviar(intencao, transport, storage){
    if (!intencao || !intencao.lead_intent_id) throw new Error("intenção inválida");
    if (typeof transport !== "function") throw new Error("transport obrigatório");
    atualizar(intencao.lead_intent_id, { status:"SENDING", tentativas:(Number(intencao.tentativas)||0)+1 }, storage);
    try {
      const ack = await transport(intencao.payload, intencao);
      concluir(intencao.lead_intent_id, ack || { ok:true }, storage);
      return { ok:true, ack:ack || null, lead_intent_id:intencao.lead_intent_id };
    } catch(e) {
      const status = e && (e.status || e.httpStatus || e.statusCode);
      const c = classificarHttp(status);
      atualizar(intencao.lead_intent_id, { status:"LOCAL_PENDING", ultimo_erro:(e&&e.message)||String(e), retryable:c.retryable }, storage);
      e.retryable = c.retryable;
      throw e;
    }
  }

  function assertRegras(){
    const falhas=[];let total=0;const ok=(c,m)=>{total++;if(!c)falhas.push(m)};
    const mem={v:null,getItem(){return this.v},setItem(k,v){this.v=v}};
    const i=registrar({email:"x@y.com"},mem);
    ok(!!i.lead_intent_id && i.payload.lead_intent_id===i.lead_intent_id,"ID precisa existir dentro e fora do payload");
    ok(pendentes(mem).length===1&&pendentes(mem)[0].status==="LOCAL_PENDING","registro nasce pendente antes do transporte");
    concluir(i.lead_intent_id,{lead_id:123},mem);ok(pendentes(mem).length===0,"ACK remove item da lista de pendentes");
    removerConcluidos(mem);ok(ler(mem).length===0,"concluídos podem ser limpos após ACK");
    ok(classificarHttp(503).retryable===true&&classificarHttp(429).retryable===true,"429/503 devem ser retryable");
    ok(classificarHttp(400).retryable===false&&classificarHttp(403).retryable===false,"4xx de cliente não entram em auto-retry");
    const r={ok:!falhas.length,total,falhas};console.log("InboundResiliencia.assertRegras:",JSON.stringify(r,null,2));return r;
  }

  return { STORAGE_KEY, MAX_ITENS, ler, novaIntencao, registrar, atualizar, concluir, removerConcluidos, pendentes, classificarHttp, enviar, assertRegras };
})();
