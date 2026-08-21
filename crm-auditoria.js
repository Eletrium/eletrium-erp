// crm-auditoria.js — núcleo compartilhado da Fila_Auditoria_Leads.
// Contrato: Roadmap CRM/Comercial v1.1. Requer graph.js (EG) carregado antes.
//
// Regras centrais:
// - Submission_ID identifica a SUBMISSÃO e é a chave de idempotência do lead.
// - ID_Origem identifica a entrada estável no funil (PNCP, indicação, etc.).
// - CPF/CNPJ identifica a CONTA, nunca deduplica uma nova demanda/oportunidade.
// - processamento, auditoria e promoção são estados ortogonais.
// - este módulo NUNCA cria Cliente/Conta ou Proposta; promoção é outro fluxo.
window.CRMAuditoria = (function () {
  "use strict";

  const LISTA = "Fila_Auditoria_Leads";
  const VERSAO_ENVELOPE = 2;

  const CAMPOS_OBRIGATORIOS = [
    "Submission_ID", "Origem_Lead", "ID_Origem", "Data_Recebimento",
    "Status_Processamento", "Status_Auditoria", "Status_Promocao"
  ];

  // Compatibilidade + campos do roadmap. Só são escritos quando existem no schema real.
  const CAMPOS_OPCIONAIS = [
    "Title", "Dados_Brutos", "RazaoSocial_Nome", "Chave_Dedupe",
    "Tipo_Documento", "Documento_Normalizado", "Modelo_Score", "Versao_Modelo_Score",
    "Score_Cobertura", "Consentimento_Valor", "Consentimento_Data",
    "Aviso_Privacidade_Versao", "Tentativas_Processamento", "Ultimo_Erro_Codigo",
    "Ultimo_Erro_Detalhe", "Data_Proxima_Tentativa", "Revisor", "Data_Auditoria",
    "Motivo_Rejeicao", "Proposta_Vinculada",
    // Inbound
    "UTM_Source", "UTM_Campaign", "URL_Origem",
    // Outbound (quando vier do processador/staging, não do importador direto)
    "Lote_Importacao_ID", "Linha_Origem_ID", "Fonte_Enriquecimento", "Data_Enriquecimento",
    // Licitações
    "PNCP_ID", "Link_Edital", "Valor_Estimado", "UF", "Tensao_kV",
    "Avaliar_Consorcio", "Avaliar_Logistica", "Avaliacao_Humana_Pendente",
    // Indicação
    "Indicado_Por", "Relacao_Indicador", "Data_Agradecimento", "Resultado_Indicacao",
    // campos legados úteis se existirem
    "Contato_Nome", "Email", "Telefone", "Documento", "Tipo_Pessoa", "Canal_Origem", "Link_Origem"
  ];

  const norm = v => String(v == null ? "" : v).trim();
  const agoraIso = () => new Date().toISOString();
  const normKey = v => norm(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9._:-]+/g, "-").replace(/^-|-$/g, "");

  function normalizarDocumento(tipo, valor) {
    const t = norm(tipo).toUpperCase();
    if (!valor) return "";
    if (t === "CPF") return String(valor).replace(/\D/g, "");
    if (t === "CNPJ") return String(valor).toUpperCase().replace(/[^0-9A-Z]/g, "");
    return String(valor).toUpperCase().replace(/[^0-9A-Z]/g, "");
  }

  function hashFNV1a(texto) {
    let h = 0x811c9dc5;
    for (const ch of String(texto || "")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0");
  }

  function stableStringify(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
    return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  }

  function identidade(lead) {
    const l = lead || {};
    const origem = norm(l.origem || l.origem_lead);
    const submissionId = norm(l.submission_id || l.Submission_ID);
    const origemId = norm(l.origem_id || l.ID_Origem || l.source_id);
    if (!origem) throw new Error("Origem_Lead é obrigatória");
    if (!submissionId) throw new Error("Submission_ID é obrigatório — não deduza por CNPJ/e-mail");
    if (!origemId) throw new Error("ID_Origem é obrigatório — use a identidade estável do funil");
    return { origem, submissionId, origemId };
  }

  // Chave auxiliar/legada; a garantia canônica é Submission_ID UNIQUE no SharePoint.
  function chaveDedupe(lead) { return identidade(lead).submissionId; }

  function mapaColunas(colunas) {
    const m = {}; (colunas || []).forEach(c => { if (c && c.name) m[c.name] = c; }); return m;
  }

  function choicesDa(col) {
    const a = col && col.choice && col.choice.choices;
    return Array.isArray(a) ? a.map(String) : null;
  }

  async function inspecionarSchema() {
    const cols = await EG.listColumns(LISTA);
    const porNome = mapaColunas(cols);
    const faltando = CAMPOS_OBRIGATORIOS.filter(c => !porNome[c]);
    const presentes = CAMPOS_OBRIGATORIOS.concat(CAMPOS_OPCIONAIS)
      .filter((c, i, a) => a.indexOf(c) === i && porNome[c]);
    return {
      ok: faltando.length === 0,
      lista: LISTA, faltando, presentes, porNome,
      submissionUnique: !!(porNome.Submission_ID && porNome.Submission_ID.enforceUniqueValues === true),
      escolhas: {
        Origem_Lead: choicesDa(porNome.Origem_Lead),
        Status_Processamento: choicesDa(porNome.Status_Processamento),
        Status_Auditoria: choicesDa(porNome.Status_Auditoria),
        Status_Promocao: choicesDa(porNome.Status_Promocao)
      }
    };
  }

  function validarChoice(schema, campo, valor) {
    if (valor == null || valor === "") return;
    const choices = schema && schema.escolhas && schema.escolhas[campo];
    if (!Array.isArray(choices)) throw new Error("não é possível validar Choice " + campo + " no schema real");
    if (!choices.includes(String(valor))) throw new Error(campo + "='" + valor + "' não existe no SharePoint; choices: " + choices.join(" | "));
  }

  function payloadFingerprint(lead) {
    const l = Object.assign({}, lead || {});
    // timestamps de transporte não devem transformar um retry idêntico em conflito.
    delete l.capturado_em; delete l.enviado_em; delete l.Data_Recebimento;
    return hashFNV1a(stableStringify(l));
  }

  function dadosBrutos(lead, ids, meta) {
    const l = Object.assign({}, lead || {}); delete l.__schema;
    return JSON.stringify({
      _crm: {
        envelope_version: VERSAO_ENVELOPE,
        submission_id: ids.submissionId,
        origem: ids.origem,
        origem_id: ids.origemId,
        payload_fingerprint: payloadFingerprint(l),
        capturado_em: norm(l.capturado_em || l.enviado_em || agoraIso()),
        produtor: norm((meta || {}).produtor || "eletrium-erp-web")
      },
      lead: l
    });
  }

  function parseDadosBrutos(v) {
    if (v == null || v === "") return null;
    try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
  }

  async function localizarPorSubmission(submissionId) {
    const itens = await EG.listItems(LISTA);
    return itens.find(it => norm(((it || {}).fields || {}).Submission_ID) === submissionId) || null;
  }

  function equivalenciaDuplicado(existing, lead) {
    const f = (existing && existing.fields) || {};
    const bruto = parseDadosBrutos(f.Dados_Brutos);
    if (!(bruto && bruto._crm && bruto._crm.payload_fingerprint)) {
      return { verificavel: false, equivalente: false, motivo: "registro existente sem fingerprint do envelope v2" };
    }
    const esperado = payloadFingerprint(lead);
    return {
      verificavel: true,
      equivalente: bruto._crm.payload_fingerprint === esperado,
      motivo: bruto._crm.payload_fingerprint === esperado ? null : "mesmo Submission_ID com payload divergente"
    };
  }

  function copiarSeExiste(fields, schema, campo, valor) {
    if (!schema.porNome[campo] || valor == null || valor === "") return;
    fields[campo] = valor;
  }

  function camposParaCriacao(lead, schema, meta) {
    const l = lead || {}; const ids = identidade(l);
    validarChoice(schema, "Origem_Lead", ids.origem);
    validarChoice(schema, "Status_Processamento", l.status_processamento);
    validarChoice(schema, "Status_Auditoria", l.status_auditoria);
    validarChoice(schema, "Status_Promocao", l.status_promocao);

    const recebido = norm(l.data_recebimento || l.capturado_em || l.enviado_em || agoraIso());
    const tipoDoc = norm(l.tipo_documento || (norm(l.tipo_pessoa).toUpperCase() === "PJ" ? "CNPJ" : norm(l.tipo_pessoa).toUpperCase() === "PF" ? "CPF" : ""));
    const docNorm = normalizarDocumento(tipoDoc, l.documento_normalizado || l.documento || l.cnpj_cpf);

    const fields = {
      Submission_ID: ids.submissionId,
      Origem_Lead: ids.origem,
      ID_Origem: ids.origemId,
      Data_Recebimento: recebido
    };

    copiarSeExiste(fields, schema, "Status_Processamento", l.status_processamento);
    copiarSeExiste(fields, schema, "Status_Auditoria", l.status_auditoria);
    copiarSeExiste(fields, schema, "Status_Promocao", l.status_promocao);
    copiarSeExiste(fields, schema, "Title", norm(l.titulo || l.razao_social_nome || l.empresa || l.nome || ids.submissionId));
    copiarSeExiste(fields, schema, "RazaoSocial_Nome", norm(l.razao_social_nome || l.empresa || l.nome));
    copiarSeExiste(fields, schema, "Dados_Brutos", dadosBrutos(l, ids, meta));
    copiarSeExiste(fields, schema, "Chave_Dedupe", ids.submissionId);
    copiarSeExiste(fields, schema, "Tipo_Documento", tipoDoc);
    copiarSeExiste(fields, schema, "Documento_Normalizado", docNorm);
    copiarSeExiste(fields, schema, "Documento", docNorm);
    copiarSeExiste(fields, schema, "Tipo_Pessoa", norm(l.tipo_pessoa));
    copiarSeExiste(fields, schema, "Contato_Nome", norm(l.contato_nome || l.contato));
    copiarSeExiste(fields, schema, "Email", norm(l.email));
    copiarSeExiste(fields, schema, "Telefone", norm(l.telefone));
    copiarSeExiste(fields, schema, "Canal_Origem", norm(l.canal_origem || ids.origem));
    copiarSeExiste(fields, schema, "Link_Origem", norm(l.link_origem || l.url));

    // Campos específicos — só quando existem no schema real.
    [
      ["UTM_Source", l.utm_source], ["UTM_Campaign", l.utm_campaign], ["URL_Origem", l.url_origem || l.link_origem],
      ["Aviso_Privacidade_Versao", l.aviso_privacidade_versao],
      ["Lote_Importacao_ID", l.lote_importacao_id], ["Linha_Origem_ID", l.linha_origem_id],
      ["Fonte_Enriquecimento", l.fonte_enriquecimento], ["Data_Enriquecimento", l.data_enriquecimento],
      ["PNCP_ID", l.pncp_id], ["Link_Edital", l.link_edital || l.link_origem], ["Valor_Estimado", l.valor_estimado], ["UF", l.uf],
      ["Tensao_kV", l.tensao_kv], ["Avaliar_Consorcio", l.avaliar_consorcio], ["Avaliar_Logistica", l.avaliar_logistica],
      ["Avaliacao_Humana_Pendente", l.avaliacao_humana_pendente],
      ["Indicado_Por", l.indicado_por || l.indicador_nome], ["Relacao_Indicador", l.relacao_indicador || l.indicador_vinculo],
      ["Data_Agradecimento", l.data_agradecimento], ["Resultado_Indicacao", l.resultado_indicacao]
    ].forEach(([campo, valor]) => copiarSeExiste(fields, schema, campo, valor));

    if (schema.porNome.Consentimento_Valor && typeof l.consentimento === "boolean") fields.Consentimento_Valor = l.consentimento;
    copiarSeExiste(fields, schema, "Consentimento_Data", l.consentimento_data || l.consentimento_em);
    return fields;
  }

  async function registrar(lead, opts) {
    const o = opts || {}; const ids = identidade(lead);
    const schema = await inspecionarSchema();
    if (!schema.ok) { const e = new Error("schema incompatível; faltam: " + schema.faltando.join(", ")); e.schema = schema; e.failClosed = true; throw e; }

    const existente = await localizarPorSubmission(ids.submissionId);
    if (existente) {
      const eq = equivalenciaDuplicado(existente, lead);
      if (!eq.verificavel || !eq.equivalente) {
        const e = new Error(eq.motivo || "Submission_ID já existe e equivalência não pôde ser provada");
        e.code = "SUBMISSION_CONFLICT"; e.existing = existente; e.failClosed = true; throw e;
      }
      return { ok: true, duplicado: true, criado: false, item: existente, item_id: existente.id, submission_id: ids.submissionId, schema };
    }

    const fields = camposParaCriacao(lead, schema, o.meta);
    const criado = await EG.createItem(LISTA, fields);
    return { ok: true, duplicado: false, criado: true, item: criado, item_id: criado && criado.id, submission_id: ids.submissionId, schema };
  }

  function assertRegras() {
    const falhas=[]; let total=0; const ok=(c,m)=>{total++;if(!c)falhas.push(m)};
    const a={origem:"Indicação",submission_id:"IND-1",origem_id:"IND-1",tipo_documento:"CNPJ",documento:"11.222.333/0001-81",razao_social_nome:"Empresa",contexto:"A"};
    const b={...a,submission_id:"IND-2",origem_id:"IND-2",contexto:"B"};
    ok(chaveDedupe(a)==="IND-1" && chaveDedupe(b)==="IND-2", "duas demandas do mesmo CNPJ precisam de Submission_ID distintos");
    ok(normalizarDocumento("CNPJ","12.abc.345/01de-35")==="12ABC34501DE35", "CNPJ alfanumérico precisa ser preservado em maiúsculas");
    ok(normalizarDocumento("CPF","529.982.247-25")==="52998224725", "CPF precisa virar 11 dígitos");
    let bloqueou=false; try{chaveDedupe({origem:"Indicação",documento:"11222333000181"})}catch{bloqueou=true} ok(bloqueou,"CNPJ sozinho nunca pode virar identidade da submissão");
    const ids=identidade(a); const env=parseDadosBrutos(dadosBrutos(a,ids,{produtor:"teste"}));
    ok(env._crm.submission_id==="IND-1" && env._crm.envelope_version===2 && !!env._crm.payload_fingerprint,"envelope v2 precisa carregar identidade e fingerprint");
    const r={ok:!falhas.length,total,falhas}; console.log("CRMAuditoria.assertRegras:",JSON.stringify(r,null,2)); return r;
  }

  return {
    LISTA, VERSAO_ENVELOPE, CAMPOS_OBRIGATORIOS, CAMPOS_OPCIONAIS,
    normKey, normalizarDocumento, identidade, chaveDedupe, payloadFingerprint,
    parseDadosBrutos, inspecionarSchema, validarChoice, localizarPorSubmission,
    equivalenciaDuplicado, camposParaCriacao, registrar, assertRegras
  };
})();
