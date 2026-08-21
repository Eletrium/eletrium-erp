// inbound-resiliencia.js — journal local OPCIONAL para o Inbound.
// O cenário Inbound já foi provado em 11/08; este módulo NÃO está ligado ao
// inbound.html automaticamente. Serve como hardening futuro se a versão pública
// for reconciliada com o código live. O ID canônico é Submission_ID.
window.InboundResiliencia=(function(){
  "use strict";
  const STORAGE_KEY="eletrium_inbound_submission_journal_v1",MAX_ITENS=50;
  const agoraIso=()=>new Date().toISOString();
  const rid=()=>{if(typeof crypto!=="undefined"&&crypto&&typeof crypto.randomUUID==="function")return crypto.randomUUID();return"sub-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10)};
  function ler(storage){const s=storage||window.localStorage;try{const v=JSON.parse(s.getItem(STORAGE_KEY)||"[]");return Array.isArray(v)?v:[]}catch{return[]}}
  function gravar(itens,storage){(storage||window.localStorage).setItem(STORAGE_KEY,JSON.stringify((itens||[]).slice(-MAX_ITENS)))}
  function novaIntencao(payload,id){const submissionId=id||rid();return{submission_id:submissionId,criado_em:agoraIso(),atualizado_em:agoraIso(),status:"LOCAL_PENDING",tentativas:0,ultimo_erro:null,payload:Object.assign({},payload||{},{submission_id:submissionId})}}
  function registrar(payload,storage){const itens=ler(storage),i=novaIntencao(payload);itens.push(i);gravar(itens,storage);return i}
  function atualizar(id,patch,storage){const itens=ler(storage),idx=itens.findIndex(x=>x&&x.submission_id===id);if(idx<0)return null;itens[idx]=Object.assign({},itens[idx],patch||{},{atualizado_em:agoraIso()});gravar(itens,storage);return itens[idx]}
  const concluir=(id,ack,storage)=>atualizar(id,{status:"ACKED",ack:ack||null,ultimo_erro:null},storage);
  function removerConcluidos(storage){const itens=ler(storage).filter(x=>x&&x.status!=="ACKED");gravar(itens,storage);return itens}
  const pendentes=storage=>ler(storage).filter(x=>x&&x.status!=="ACKED");
  function classificarHttp(status){const n=Number(status);if(n===429||[500,502,503,504].includes(n))return{retryable:true,tipo:"transitorio"};if(n>=400&&n<500)return{retryable:false,tipo:"cliente"};return{retryable:false,tipo:"desconhecido"}}
  async function enviar(intencao,transport,storage){if(!intencao||!intencao.submission_id)throw Error("Submission_ID ausente");if(typeof transport!=="function")throw Error("transport obrigatório");const atual=atualizar(intencao.submission_id,{status:"SENDING",tentativas:(Number(intencao.tentativas)||0)+1},storage);try{const ack=await transport(atual.payload,atual);concluir(atual.submission_id,ack||{ok:true},storage);return{ok:true,ack:ack||null,submission_id:atual.submission_id}}catch(e){const c=classificarHttp(e&&(e.status||e.httpStatus||e.statusCode));atualizar(atual.submission_id,{status:"LOCAL_PENDING",ultimo_erro:(e&&e.message)||String(e),retryable:c.retryable},storage);e.retryable=c.retryable;throw e}}
  function assertRegras(){const f=[];let total=0,ok=(c,m)=>{total++;if(!c)f.push(m)},mem={v:null,getItem(){return this.v},setItem(k,v){this.v=v}},i=registrar({email:"x@y.com"},mem);ok(!!i.submission_id&&i.payload.submission_id===i.submission_id,"Submission_ID deve existir antes do transporte");ok(pendentes(mem).length===1,"registro nasce pendente");concluir(i.submission_id,{item_id:123},mem);ok(pendentes(mem).length===0,"ACK encerra pendência");ok(classificarHttp(503).retryable&&classificarHttp(429).retryable,"429/5xx transitórios retryable");ok(!classificarHttp(403).retryable,"403 sem auto-loop");const r={ok:!f.length,total,falhas:f};console.log("InboundResiliencia.assertRegras:",JSON.stringify(r,null,2));return r}
  return{STORAGE_KEY,MAX_ITENS,ler,novaIntencao,registrar,atualizar,concluir,removerConcluidos,pendentes,classificarHttp,enviar,assertRegras};
})();