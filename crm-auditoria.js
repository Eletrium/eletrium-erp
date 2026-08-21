// crm-auditoria.js — núcleo compartilhado dos funis do CRM Eletrium.
// Requer graph.js carregado antes e usa SOMENTE Microsoft Graph delegado via EG.
//
// Objetivos:
// 1) nunca inventar schema da Fila_Auditoria_Leads: inspeciona as colunas reais;
// 2) persistir o lead ANTES de qualquer IA/enriquecimento;
// 3) oferecer dedupe rastreável entre os funis;
// 4) nunca criar Proposta/Cliente automaticamente — promoção humana fica fora daqui.
//
// Compatibilidade: campos adicionais são usados somente se EXISTIREM na lista real.
window.CRMAuditoria = (function () {
  "use strict";

  const LISTA = "Fila_Auditoria_Leads";
  const VERSAO_ENVELOPE = 1;

  // Mínimo já documentado pelo Inbound versionado. Sem estes campos não há como
  // preservar origem + dados crus sem inventar outro modelo: falhamos fechado.
  const CAMPOS_OBRIGATORIOS = ["Origem_Lead", "Dados_Brutos", "RazaoSocial_Nome"];

  const CAMPOS_OPCIONAIS = [
    "Title", "Chave_Dedupe", "Data_Captura", "Data_Entrada", "Status_Auditoria",
    "Score_PJPF", "Canal_Origem", "Link_Origem", "Origem_ID", "Contato_Nome",
    "Email", "Telefone", "Documento", "Tipo_Pessoa", "Motivo_Descarte"
  ];

  const norm = (v) => String(v == null ? "" : v).trim();
  const normKey = (v) => norm(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  const soDoc = (v) => norm(v).toUpperCase().replace(/[^0-9A-Z]/g, "");
  const agoraIso = () => new Date().toISOString();

  function hashFNV1a(texto) {
    // Hash NÃO criptográfico: serve só para chave curta/determinística de dedupe.
    // Não é usado para autenticação, assinatura ou segredo.
    let h = 0x811c9dc5;
    const s = String(texto || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }

  function chaveDedupe(lead) {
    const l = lead || {};
    const origem = normKey(l.origem || l.origem_lead || "DESCONHECIDA");
    const origemId = normKey(l.origem_id || l.source_id || "");
    const doc = soDoc(l.documento || l.cnpj_cpf || "");
    const email = norm(l.email).toLowerCase();
    const tel = String(l.telefone || "").replace(/\D/g, "");
    const empresa = normKey(l.razao_social_nome || l.empresa || l.nome || "");

    // IDs estáveis da origem ganham prioridade (PNCP, linha de lote, etc.).
    let identidade = origemId ? "ID:" + origemId : "";
    if (!identidade && doc) identidade = "DOC:" + doc;
    if (!identidade && email) identidade = "MAIL:" + email;
    if (!identidade && tel) identidade = "TEL:" + tel;
    if (!identidade && empresa) identidade = "NOME:" + empresa;
    if (!identidade) throw new Error("não é possível gerar chave de dedupe: informe origem_id, documento, e-mail, telefone ou nome/empresa");

    const base = origem + "|" + identidade;
    return "CRM1-" + origem + "-" + hashFNV1a(base);
  }

  function mapaColunas(colunas) {
    const m = {};
    (colunas || []).forEach(c => { if (c && c.name) m[c.name] = c; });
    return m;
  }

  async function inspecionarSchema() {
    const cols = await EG.listColumns(LISTA);
    const porNome = mapaColunas(cols);
    const faltando = CAMPOS_OBRIGATORIOS.filter(c => !porNome[c]);
    const presentes = CAMPOS_OBRIGATORIOS.concat(CAMPOS_OPCIONAIS).filter((c, i, a) => a.indexOf(c) === i && porNome[c]);
    const chave = porNome.Chave_Dedupe || null;
    return {
      ok: faltando.length === 0,
      lista: LISTA,
      faltando,
      presentes,
      porNome,
      chaveDedupeServerSide: !!(chave && chave.enforceUniqueValues === true)
    };
  }

  function dadosBrutos(lead, chave, meta) {
    const l = Object.assign({}, lead || {});
    delete l.__schema;
    return JSON.stringify({
      _crm: {
        envelope_version: VERSAO_ENVELOPE,
        dedupe_key: chave,
        origem: norm(l.origem || l.origem_lead || ""),
        origem_id: norm(l.origem_id || l.source_id || "") || null,
        capturado_em: agoraIso(),
        produtor: norm((meta || {}).produtor || "eletrium-erp-web")
      },
      lead: l
    });
  }

  function parseDadosBrutos(v) {
    if (v == null || v === "") return null;
    try { return typeof v === "string" ? JSON.parse(v) : v; }
    catch { return null; }
  }

  async function localizarDuplicado(chave, schema) {
    // A lista é a fonte canônica. Enquanto não houver uma chave UNIQUE server-side,
    // fazemos reconciliação por leitura antes do POST e deixamos isso explícito.
    // A proteção forte contra corrida só existe quando Chave_Dedupe estiver com
    // enforceUniqueValues=true no SharePoint.
    const itens = await EG.listItems(LISTA);
    for (const it of itens) {
      const f = (it && it.fields) || {};
      if (schema.porNome.Chave_Dedupe && norm(f.Chave_Dedupe) === chave) return it;
      const bruto = parseDadosBrutos(f.Dados_Brutos);
      if (bruto && bruto._crm && bruto._crm.dedupe_key === chave) return it;
    }
    return null;
  }

  function copiarSeExiste(fields, schema, campo, valor) {
    if (!schema.porNome[campo]) return;
    if (valor == null || valor === "") return;
    fields[campo] = valor;
  }

  function camposParaCriacao(lead, schema, chave, meta) {
    const l = lead || {};
    const origem = norm(l.origem || l.origem_lead);
    const nome = norm(l.razao_social_nome || l.empresa || l.nome);
    if (!origem) throw new Error("Origem_Lead é obrigatória");
    if (!nome) throw new Error("RazaoSocial_Nome é obrigatório");

    const fields = {
      Origem_Lead: origem,
      RazaoSocial_Nome: nome,
      Dados_Brutos: dadosBrutos(l, chave, meta)
    };

    copiarSeExiste(fields, schema, "Title", norm(l.titulo || nome));
    copiarSeExiste(fields, schema, "Chave_Dedupe", chave);
    copiarSeExiste(fields, schema, "Data_Captura", norm(l.capturado_em || agoraIso()));
    copiarSeExiste(fields, schema, "Data_Entrada", norm(l.capturado_em || agoraIso()));
    copiarSeExiste(fields, schema, "Canal_Origem", norm(l.canal_origem || origem));
    copiarSeExiste(fields, schema, "Link_Origem", norm(l.link_origem || l.url || ""));
    copiarSeExiste(fields, schema, "Origem_ID", norm(l.origem_id || l.source_id || ""));
    copiarSeExiste(fields, schema, "Contato_Nome", norm(l.contato_nome || l.contato || ""));
    copiarSeExiste(fields, schema, "Email", norm(l.email));
    copiarSeExiste(fields, schema, "Telefone", norm(l.telefone));
    copiarSeExiste(fields, schema, "Documento", norm(l.documento || l.cnpj_cpf || ""));
    copiarSeExiste(fields, schema, "Tipo_Pessoa", norm(l.tipo_pessoa));
    if (schema.porNome.Score_PJPF && Number.isFinite(Number(l.score_pjpf))) fields.Score_PJPF = Number(l.score_pjpf);
    copiarSeExiste(fields, schema, "Motivo_Descarte", norm(l.motivo_descarte));
    // Status_Auditoria NÃO é inventado aqui. Só será escrito quando houver contrato
    // formal dos choices reais; a ausência mantém o default configurado na lista.
    return fields;
  }

  async function registrar(lead, opts) {
    const o = opts || {};
    const schema = await inspecionarSchema();
    if (!schema.ok) {
      const e = new Error("schema de " + LISTA + " incompatível; faltam: " + schema.faltando.join(", "));
      e.schema = schema; e.failClosed = true; throw e;
    }

    const chave = chaveDedupe(lead);
    if (o.dedupe !== false) {
      const dup = await localizarDuplicado(chave, schema);
      if (dup) return { ok: true, duplicado: true, criado: false, item: dup, item_id: dup.id, dedupe_key: chave, schema };
    }

    const fields = camposParaCriacao(lead, schema, chave, o.meta);
    const criado = await EG.createItem(LISTA, fields);
    return { ok: true, duplicado: false, criado: true, item: criado, item_id: criado && criado.id, dedupe_key: chave, schema };
  }

  // Regras puras para harness/jsdom/console. Não acessa rede.
  function assertRegras() {
    const falhas = []; let total = 0;
    const ok = (cond, msg) => { total++; if (!cond) falhas.push(msg); };
    const a = chaveDedupe({ origem: "Indicação", documento: "11.222.333/0001-81", razao_social_nome: "A" });
    const b = chaveDedupe({ origem: "Indicação", documento: "11222333000181", razao_social_nome: "Outra grafia" });
    const c = chaveDedupe({ origem: "Licitações", origem_id: "PNCP-123", razao_social_nome: "Órgão X" });
    const d = chaveDedupe({ origem: "Licitações", origem_id: "PNCP-123", razao_social_nome: "Órgão renomeado" });
    ok(a === b, "documento equivalente deve gerar a mesma chave dentro da mesma origem");
    ok(c === d, "origem_id estável deve dominar nome mutável");
    ok(a !== c, "origens/identidades distintas não podem colidir por construção do base string");
    const env = parseDadosBrutos(dadosBrutos({ origem: "Indicação", razao_social_nome: "X", email: "x@y.com" }, "K", { produtor: "teste" }));
    ok(env && env._crm && env._crm.dedupe_key === "K" && env.lead.email === "x@y.com", "envelope precisa preservar chave e payload cru");
    ok(CAMPOS_OBRIGATORIOS.includes("Dados_Brutos") && CAMPOS_OBRIGATORIOS.includes("Origem_Lead"), "origem e dados crus são obrigatórios");
    const r = { ok: !falhas.length, total, falhas };
    console.log("CRMAuditoria.assertRegras:", JSON.stringify(r, null, 2));
    return r;
  }

  return {
    LISTA, VERSAO_ENVELOPE, CAMPOS_OBRIGATORIOS,
    normKey, chaveDedupe, parseDadosBrutos, inspecionarSchema,
    localizarDuplicado, camposParaCriacao, registrar, assertRegras
  };
})();
