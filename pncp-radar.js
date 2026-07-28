#!/usr/bin/env node
/**
 * pncp-radar.js — Radar de editais do PNCP para a Eletrium
 *
 * Consulta a API pública de consultas do PNCP (Portal Nacional de Contratações
 * Públicas), filtra editais por critérios de relevância da Eletrium e grava os
 * relevantes em arquivo (JSON consultável + HTML de leitura).
 *
 * Node >= 18 (usa fetch global). Testado em Node v24.14.1.
 * Sem dependências externas. Sem autenticação (a API de CONSULTA é pública).
 *
 * Uso:
 *   node pncp-radar.js                       # modo padrão (propostas em aberto)
 *   node pncp-radar.js --dias 30             # horizonte de encerramento (dias)
 *   node pncp-radar.js --max-paginas 20      # limita a varredura (teste rápido)
 *   node pncp-radar.js --modo publicacao     # editais publicados no período
 *   node pncp-radar.js --uf SP,MG            # sobrepõe UFS_PRIORITARIAS
 *   node pncp-radar.js --help
 */

"use strict";

const fs = require("fs");
const path = require("path");

/* ══════════════════════════════════════════════════════════════════════════
 *
 *   ⚠️  BLOCO DE CONFIGURAÇÃO — CRITÉRIOS DE RELEVÂNCIA  ⚠️
 *
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │  ATENÇÃO: OS VALORES ABAIXO SÃO **PROVISÓRIOS (PLACEHOLDER)**.     │
 *   │                                                                    │
 *   │  Eles NÃO refletem o perfil real de licitações da Eletrium.        │
 *   │  A fonte oficial dos critérios é a Seção 4 do documento            │
 *   │  `Perfil_Eletrium_Licitacoes.md` (escopo técnico, faixa de valor,  │
 *   │  prioridade geográfica) — documento que NÃO existe no repositório  │
 *   │  e cujo conteúdo ainda não foi fornecido pelo dono.                │
 *   │                                                                    │
 *   │  Enquanto isso, usamos defaults CONSERVADORES derivados apenas do  │
 *   │  ramo elétrico conhecido. Resultado: o radar funciona, mas o       │
 *   │  filtro ainda NÃO é o filtro real do negócio.                      │
 *   │                                                                    │
 *   │  >>> SUBSTITUIR ESTE BLOCO QUANDO A SEÇÃO 4 CHEGAR. <<<            │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * ══════════════════════════════════════════════════════════════════════════ */

const CONFIG = {
  /* ---------------------------------------------------------------------
   * [PROVISÓRIO] ESCOPO TÉCNICO — palavras-chave buscadas no objeto do edital.
   *
   * Escreva os termos como **RADICAIS (stems)**, não como a palavra completa.
   * O matcher permite até 3 letras extras no fim de CADA palavra do termo,
   * o que cobre plural e flexão automaticamente:
   *
   *    "instalac eletric"  ->  casa com "instalação elétrica",
   *                            "instalações elétricas", "instalacao eletrica"
   *    "subestac"          ->  casa com "subestação", "subestações"
   *
   * A comparação é feita sem acento e sem diferenciar maiúsculas (ver
   * normalizar() abaixo). Termos curtos e "colados" (NR-10 / NR 10 / NR10)
   * também são cobertos pelo match "squash" (ver casaPalavraChave()).
   * ------------------------------------------------------------------- */
  PALAVRAS_CHAVE: [
    "nr 10",            // segurança em instalações e serviços em eletricidade
    "nr 12",            // segurança em máquinas e equipamentos
    "spda",             // sistema de proteção contra descargas atmosféricas
    "para raio",        // para-raios
    "aterrament",       // aterramento / aterramentos
    "subestac",         // subestação / subestações
    "instalac eletric", // instalação(ões) elétrica(s)
    "manutenc eletric", // manutenção elétrica
    "cabine primari",   // cabine primária
    "laudo eletric",    // laudo elétrico
  ],

  /* ---------------------------------------------------------------------
   * [PROVISÓRIO] FAIXA DE VALOR (R$) sobre `valorTotalEstimado`.
   * null = SEM FILTRO. Editais sem valor informado NUNCA são descartados
   * por este critério (só deixam de ganhar o bônus de score).
   * ------------------------------------------------------------------- */
  VALOR_MIN: null,
  VALOR_MAX: null,

  /* ---------------------------------------------------------------------
   * [PROVISÓRIO] PRIORIDADE GEOGRÁFICA.
   * Lista vazia = TODAS as UFs (sem filtro geográfico).
   * Ex.: ["SP", "MG"] passa a filtrar E a dar bônus de score.
   * ------------------------------------------------------------------- */
  UFS_PRIORITARIAS: [],

  /* ---------------------------------------------------------------------
   * [PROVISÓRIO] Score mínimo para um edital entrar no radar.
   * 1 = basta casar uma palavra-chave (conservador: prefere recall).
   * ------------------------------------------------------------------- */
  SCORE_MINIMO: 1,

  /* ---------------------------------------------------------------------
   * Modalidades de contratação (tabela de domínio do PNCP).
   * null = todas (o parâmetro é omitido — permitido no modo "proposta").
   *   1 Leilão-Eletrônico     2 Diálogo Competitivo   3 Concurso
   *   4 Concorrência-Eletrônica  5 Concorrência-Presencial
   *   6 Pregão-Eletrônico     7 Pregão-Presencial     8 Dispensa de Licitação
   *   9 Inexigibilidade      10 Manifestação de Interesse
   *  11 Pré-qualificação     12 Credenciamento       13 Leilão-Presencial
   * OBS: no modo "publicacao" a modalidade é OBRIGATÓRIA pela API; se estiver
   * null, o script varre a lista MODALIDADES_PADRAO_PUBLICACAO.
   * ------------------------------------------------------------------- */
  MODALIDADES: null,
  MODALIDADES_PADRAO_PUBLICACAO: [4, 6, 8, 9, 12],

  /* --------------------------- Operacional --------------------------- */
  MODO: "proposta",       // "proposta" (recebimento aberto) | "publicacao"
  JANELA_DIAS: 60,        // horizonte, em dias, a partir de hoje
  MAX_PAGINAS: null,      // null = varre tudo; nº = limita (teste rápido)
  DIR_SAIDA: path.join(__dirname, "pncp-radar-data"),
};

/* ══════════════════════════════════════════════════════════════════════════
 * FIM DO BLOCO DE CONFIGURAÇÃO — abaixo é implementação
 * ══════════════════════════════════════════════════════════════════════════ */

// API pública de CONSULTA do PNCP. Não exige autenticação (token só é exigido
// nas APIs de manutenção/inserção, que não usamos aqui).
const API_BASE = "https://pncp.gov.br/api/consulta/v1";

// Limites REAIS observados em teste contra a API em 2026-07-27:
//  - tamanhoPagina: mínimo 10, MÁXIMO 50 (o manual v1.0 diz 500 — está errado;
//    51+ devolve 400 "Tamanho de página inválido").
//  - /contratacoes/publicacao: intervalo máx. de 365 dias (senão 422).
//  - Rate limit agressivo e SEM cabeçalhos (nada de Retry-After/X-RateLimit):
//    rajadas devolvem 429 com corpo HTML (não JSON). 1,2 s aguenta rajadas
//    curtas, mas em varredura longa estoura; 2 s é a cadência de trabalho.
//  - O PNCP também devolve 500 "Erro na comunicação com o banco de dados" e
//    timeouts de forma intermitente, por instabilidade do próprio portal.
//    Por isso o retry é generoso e o backoff começa alto.
const TAMANHO_PAGINA = 50;
const INTERVALO_MS = 2000;
const TIMEOUT_MS = 60000;
const MAX_TENTATIVAS = 6;
const BACKOFF_INICIAL_MS = 5000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ CLI ------------------------------------ */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--dias") out.dias = Number(argv[++i]);
    else if (a === "--max-paginas") out.maxPaginas = Number(argv[++i]);
    else if (a === "--modo") out.modo = String(argv[++i] || "").trim();
    else if (a === "--uf") out.uf = String(argv[++i] || "").trim();
    else if (a === "--saida") out.saida = String(argv[++i] || "").trim();
  }
  return out;
}

function ajuda() {
  console.log(`
pncp-radar.js — radar de editais do PNCP para a Eletrium

  --modo <proposta|publicacao>  proposta  = recebimento de propostas em aberto (padrão)
                                publicacao = editais publicados na janela
  --dias <n>                    horizonte em dias a partir de hoje (padrão ${CONFIG.JANELA_DIAS})
  --max-paginas <n>             limita páginas por consulta (teste rápido)
  --uf <SP,MG>                  sobrepõe UFS_PRIORITARIAS
  --saida <dir>                 diretório de saída (padrão ./pncp-radar-data)
  --help

ATENÇÃO: os critérios de relevância no topo do arquivo são PROVISÓRIOS.
Substituir pelos critérios reais da Seção 4 de Perfil_Eletrium_Licitacoes.md.
`);
}

/* --------------------- Normalização e matching ------------------------- */

/** minúsculas, sem acento, só alfanumérico, espaços colapsados. */
function normalizar(s) {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacríticos (acentos)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** mesma coisa, mas sem nenhum separador: "NR-10"/"NR 10"/"NR10" -> "nr10". */
function squash(s) {
  return normalizar(s).replace(/ /g, "");
}

const _cacheRegex = new Map();
/**
 * Regex de um termo-radical: cada palavra pode ganhar até 3 letras extras no
 * fim (cobre plural/flexão), com fronteira de palavra à esquerda.
 *   "instalac eletric" -> /(^| )instalac[a-z0-9]{0,3} +eletric[a-z0-9]{0,3}/
 */
function regexDoTermo(termo) {
  if (_cacheRegex.has(termo)) return _cacheRegex.get(termo);
  const corpo = normalizar(termo)
    .split(" ")
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[a-z0-9]{0,3}")
    .join(" +");
  const re = new RegExp("(^| )" + corpo);
  _cacheRegex.set(termo, re);
  return re;
}

/** true se o termo aparece no texto (match por radical OU por forma colada). */
function casaPalavraChave(termo, textoNorm, textoSquash) {
  if (regexDoTermo(termo).test(textoNorm)) return true;
  const ts = squash(termo);
  return ts.length >= 4 && textoSquash.includes(ts);
}

/* ------------------------------ HTTP ----------------------------------- */

let _ultimaChamada = 0;

/** GET com throttle, timeout e retry exponencial em 429/5xx/rede. */
async function getJson(url) {
  let espera = BACKOFF_INICIAL_MS;
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const desde = Date.now() - _ultimaChamada;
    if (desde < INTERVALO_MS) await sleep(INTERVALO_MS - desde);
    _ultimaChamada = Date.now();

    let resp;
    try {
      resp = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "eletrium-pncp-radar/1.0" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      ultimoErro =
        e.name === "TimeoutError"
          ? `tempo esgotado (${TIMEOUT_MS / 1000}s) ao chamar o PNCP`
          : `falha de rede ao chamar o PNCP (${e.name})`;
      console.warn(`   ...${ultimoErro}; nova tentativa em ${Math.round(espera / 1000)}s (${tentativa}/${MAX_TENTATIVAS})`);
      await sleep(espera);
      espera *= 2;
      continue;
    }

    // 204 = sucesso sem conteúdo (nenhum registro no período).
    if (resp.status === 204) return { data: [], totalPaginas: 0, totalRegistros: 0 };

    if (resp.status === 200) {
      const txt = await resp.text();
      if (!txt.trim()) return { data: [], totalPaginas: 0, totalRegistros: 0 };
      try {
        return JSON.parse(txt);
      } catch {
        ultimoErro = "o PNCP respondeu 200 mas o corpo não era JSON válido";
        await sleep(espera);
        espera *= 2;
        continue;
      }
    }

    if (resp.status === 429 || resp.status >= 500) {
      // 429 do PNCP vem como página HTML, não JSON — não tente parsear.
      ultimoErro =
        resp.status === 429
          ? "o PNCP aplicou limite de requisições (429)"
          : `o PNCP respondeu erro ${resp.status}`;
      console.warn(`   ...${ultimoErro}; nova tentativa em ${Math.round(espera / 1000)}s (${tentativa}/${MAX_TENTATIVAS})`);
      await sleep(espera);
      espera *= 2;
      continue;
    }

    // 400/422 são erros de parâmetro: retry não resolve.
    let detalhe = "";
    try {
      const j = JSON.parse(await resp.text());
      detalhe = j.message || j.error || "";
    } catch { /* corpo não-JSON: segue sem detalhe */ }
    const err = new Error(
      `PNCP recusou a consulta (HTTP ${resp.status})${detalhe ? ": " + detalhe : ""}`
    );
    err.semRetry = true;
    throw err;
  }

  throw new Error(`${ultimoErro} — desisti após ${MAX_TENTATIVAS} tentativas`);
}

/* ---------------------------- Consulta --------------------------------- */

const aaaammdd = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

function montarUrl(cfg, { modalidade, uf, pagina }) {
  const hoje = new Date();
  const fim = new Date(hoje.getTime() + cfg.JANELA_DIAS * 86400000);
  const p = new URLSearchParams();

  if (cfg.MODO === "publicacao") {
    // /contratacoes/publicacao: dataInicial, dataFinal e modalidade OBRIGATÓRIOS.
    // Janela = últimos JANELA_DIAS até hoje (editais recém-publicados).
    const ini = new Date(hoje.getTime() - cfg.JANELA_DIAS * 86400000);
    p.set("dataInicial", aaaammdd(ini));
    p.set("dataFinal", aaaammdd(hoje));
  } else {
    // /contratacoes/proposta: dataFinal obrigatório, modalidade OPCIONAL.
    p.set("dataFinal", aaaammdd(fim));
  }

  if (modalidade != null) p.set("codigoModalidadeContratacao", String(modalidade));
  if (uf) p.set("uf", uf);
  p.set("pagina", String(pagina));
  p.set("tamanhoPagina", String(TAMANHO_PAGINA));

  const rota = cfg.MODO === "publicacao" ? "contratacoes/publicacao" : "contratacoes/proposta";
  return `${API_BASE}/${rota}?${p.toString()}`;
}

/** Varre todas as páginas de uma combinação (modalidade × uf). */
async function varrer(cfg, combo, stats) {
  const registros = [];
  let pagina = 1;
  let totalPaginas = null;

  while (true) {
    const url = montarUrl(cfg, { ...combo, pagina });
    const json = await getJson(url);
    const lote = Array.isArray(json.data) ? json.data : [];

    if (totalPaginas === null) {
      totalPaginas = Number(json.totalPaginas) || 0;
      stats.totalRegistrosApi += Number(json.totalRegistros) || 0;
      if (totalPaginas > 0) {
        const rot = [
          combo.modalidade != null ? `modalidade ${combo.modalidade}` : "todas as modalidades",
          combo.uf ? `UF ${combo.uf}` : "todas as UFs",
        ].join(" / ");
        const teto = cfg.MAX_PAGINAS ? Math.min(cfg.MAX_PAGINAS, totalPaginas) : totalPaginas;
        console.log(
          `   ${rot}: ${json.totalRegistros} registros em ${totalPaginas} páginas` +
            (teto < totalPaginas ? ` (varrendo só ${teto} — limite --max-paginas)` : "")
        );
      }
    }

    registros.push(...lote);
    stats.paginasLidas++;

    if (lote.length === 0) break;
    if (totalPaginas && pagina >= totalPaginas) break;
    if (cfg.MAX_PAGINAS && pagina >= cfg.MAX_PAGINAS) {
      stats.varreduraTruncada = true;
      break;
    }
    pagina++;
  }

  return registros;
}

/* -------------------------- Score e filtro ------------------------------
 *
 * FÓRMULA DO SCORE (transparente e aditiva):
 *
 *   score = (nº de PALAVRAS_CHAVE DISTINTAS encontradas no texto do objeto)
 *         + 2  se a UF do órgão está em UFS_PRIORITARIAS   (só se configurada)
 *         + 1  se valorTotalEstimado está dentro da faixa  (só se configurada)
 *
 * Texto analisado = objetoCompra + informacaoComplementar (normalizados).
 * Entra no radar quem tiver >= 1 palavra-chave E score >= SCORE_MINIMO.
 * ---------------------------------------------------------------------- */

function avaliar(reg, cfg) {
  const texto = [reg.objetoCompra, reg.informacaoComplementar].filter(Boolean).join(" ");
  const tNorm = normalizar(texto);
  const tSquash = squash(texto);

  const encontradas = cfg.PALAVRAS_CHAVE.filter((k) => casaPalavraChave(k, tNorm, tSquash));

  const uf = reg.unidadeOrgao?.ufSigla || reg.unidadeSubRogada?.ufSigla || null;
  const valor = typeof reg.valorTotalEstimado === "number" ? reg.valorTotalEstimado : null;

  const usaUf = cfg.UFS_PRIORITARIAS.length > 0;
  const ufPrioritaria = usaUf && uf ? cfg.UFS_PRIORITARIAS.includes(uf) : false;

  const usaValor = cfg.VALOR_MIN != null || cfg.VALOR_MAX != null;
  const valorNaFaixa =
    usaValor && valor != null
      ? (cfg.VALOR_MIN == null || valor >= cfg.VALOR_MIN) &&
        (cfg.VALOR_MAX == null || valor <= cfg.VALOR_MAX)
      : false;

  let score = encontradas.length;
  if (ufPrioritaria) score += 2;
  if (valorNaFaixa) score += 1;

  return { encontradas, uf, valor, usaUf, usaValor, ufPrioritaria, valorNaFaixa, score };
}

/** Aplica os filtros em cascata, contando as baixas em cada etapa. */
function filtrar(registros, cfg, stats) {
  const aprovados = [];

  for (const reg of registros) {
    const a = avaliar(reg, cfg);

    if (a.encontradas.length === 0) { stats.reprovadosPalavraChave++; continue; }
    stats.passaramPalavraChave++;

    // Filtro geográfico: só descarta se UFS_PRIORITARIAS estiver configurada.
    if (a.usaUf && !a.ufPrioritaria) { stats.reprovadosUf++; continue; }
    stats.passaramUf++;

    // Filtro de valor: edital SEM valor informado NÃO é descartado.
    if (a.usaValor && a.valor != null && !a.valorNaFaixa) { stats.reprovadosValor++; continue; }
    if (a.usaValor && a.valor == null) stats.semValorInformado++;
    stats.passaramValor++;

    if (a.score < cfg.SCORE_MINIMO) { stats.reprovadosScore++; continue; }

    aprovados.push({
      numeroControlePNCP: reg.numeroControlePNCP,
      modalidade: reg.modalidadeNome,
      situacao: reg.situacaoCompraNome,
      objeto: reg.objetoCompra,
      orgao: reg.orgaoEntidade?.razaoSocial || null,
      cnpjOrgao: reg.orgaoEntidade?.cnpj || null,
      unidade: reg.unidadeOrgao?.nomeUnidade || null,
      uf: a.uf,
      municipio: reg.unidadeOrgao?.municipioNome || null,
      codigoIbge: reg.unidadeOrgao?.codigoIbge || null,
      valorTotalEstimado: a.valor,
      dataAberturaProposta: reg.dataAberturaProposta || null,
      dataEncerramentoProposta: reg.dataEncerramentoProposta || null,
      dataPublicacaoPncp: reg.dataPublicacaoPncp || null,
      linkSistemaOrigem: reg.linkSistemaOrigem || null,
      linkPncp: linkPncp(reg),
      score: a.score,
      palavrasChave: a.encontradas,
    });
  }

  return aprovados;
}

/** Monta a URL da página pública do edital no PNCP a partir do nº de controle. */
function linkPncp(reg) {
  const cnpj = reg.orgaoEntidade?.cnpj;
  const ano = reg.anoCompra;
  const seq = reg.sequencialCompra;
  if (!cnpj || !ano || seq == null) return null;
  return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}`;
}

/* ----------------------------- Persistência ---------------------------- */

/**
 * Idempotência: o arquivo JSON é um STORE cumulativo indexado por
 * numeroControlePNCP. Rodar duas vezes não duplica — atualiza o registro
 * existente e preserva `primeiroContatoEm` (quando o radar viu pela 1ª vez).
 */
function salvar(aprovados, cfg, stats, dirSaida) {
  fs.mkdirSync(dirSaida, { recursive: true });
  const arqJson = path.join(dirSaida, "radar-editais.json");
  const arqHtml = path.join(dirSaida, "radar-editais.html");

  let anterior = { editais: [] };
  if (fs.existsSync(arqJson)) {
    try {
      anterior = JSON.parse(fs.readFileSync(arqJson, "utf8")) || { editais: [] };
      if (!Array.isArray(anterior.editais)) anterior.editais = [];
    } catch {
      console.warn("   aviso: store anterior ilegível; será recriado do zero.");
      anterior = { editais: [] };
    }
  }

  const agora = new Date().toISOString();
  const indice = new Map();
  for (const e of anterior.editais) if (e && e.numeroControlePNCP) indice.set(e.numeroControlePNCP, e);

  let novos = 0;
  let atualizados = 0;
  for (const e of aprovados) {
    if (!e.numeroControlePNCP) continue;
    const antigo = indice.get(e.numeroControlePNCP);
    if (antigo) {
      atualizados++;
      indice.set(e.numeroControlePNCP, { ...antigo, ...e, primeiroContatoEm: antigo.primeiroContatoEm || agora, ultimoContatoEm: agora });
    } else {
      novos++;
      indice.set(e.numeroControlePNCP, { ...e, primeiroContatoEm: agora, ultimoContatoEm: agora });
    }
  }

  const editais = [...indice.values()].sort(
    (a, b) => b.score - a.score || String(a.dataEncerramentoProposta).localeCompare(String(b.dataEncerramentoProposta))
  );

  const store = {
    geradoEm: agora,
    fonte: "PNCP — API pública de consultas (https://pncp.gov.br/api/consulta/v1)",
    modo: cfg.MODO,
    janelaDias: cfg.JANELA_DIAS,
    AVISO_CRITERIOS:
      "Os critérios de relevância usados são PROVISÓRIOS (placeholder). Devem ser " +
      "substituídos pelos critérios reais da Seção 4 de Perfil_Eletrium_Licitacoes.md.",
    criteriosUsados: {
      PALAVRAS_CHAVE: cfg.PALAVRAS_CHAVE,
      VALOR_MIN: cfg.VALOR_MIN,
      VALOR_MAX: cfg.VALOR_MAX,
      UFS_PRIORITARIAS: cfg.UFS_PRIORITARIAS,
      SCORE_MINIMO: cfg.SCORE_MINIMO,
      formulaScore: "score = nº de palavras-chave distintas + 2 (UF prioritária) + 1 (valor na faixa)",
    },
    estatisticasUltimaExecucao: { ...stats, novosNestaExecucao: novos, atualizadosNestaExecucao: atualizados },
    totalEditais: editais.length,
    editais,
  };

  fs.writeFileSync(arqJson, JSON.stringify(store, null, 2), "utf8");
  fs.writeFileSync(arqHtml, gerarHtml(store), "utf8");

  return { arqJson, arqHtml, novos, atualizados, total: editais.length };
}

/* ------------------------------- HTML ---------------------------------- */

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const brl = (v) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const dataBr = (s) => (!s ? "—" : String(s).slice(0, 10).split("-").reverse().join("/"));

/**
 * HTML estático e AUTOCONTIDO: os dados são embutidos na própria página.
 * Não usa MSAL nem graph.js — não é tela do ERP autenticado. Abre com duplo
 * clique (file://) sem servidor, já que fetch de JSON local seria bloqueado.
 */
function gerarHtml(store) {
  const linhas = store.editais
    .map(
      (e) => `<tr>
      <td class="sc">${esc(e.score)}</td>
      <td><div class="obj">${esc(e.objeto)}</div>
          <div class="kw">${e.palavrasChave.map((k) => `<span>${esc(k)}</span>`).join("")}</div></td>
      <td>${esc(e.orgao || "—")}<br><small>${esc(e.municipio || "—")}/${esc(e.uf || "—")}</small></td>
      <td class="nb">${esc(brl(e.valorTotalEstimado))}</td>
      <td class="nb">${esc(dataBr(e.dataEncerramentoProposta))}</td>
      <td class="nb">${e.linkPncp ? `<a href="${esc(e.linkPncp)}" target="_blank" rel="noopener">PNCP</a>` : "—"}</td>
    </tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Radar de Editais PNCP — Eletrium</title>
<style>
  :root{color-scheme:light dark}
  *{box-sizing:border-box}
  body{margin:0;padding:24px;font:14px/1.5 system-ui,Segoe UI,sans-serif;background:#f6f7f9;color:#16202c}
  @media(prefers-color-scheme:dark){body{background:#12161c;color:#e6eaf0}}
  h1{margin:0 0 4px;font-size:22px}
  .meta{color:#6b7684;font-size:13px;margin-bottom:16px}
  .aviso{border-left:4px solid #d97706;background:#fff7ed;color:#7c2d12;padding:12px 16px;border-radius:6px;margin-bottom:18px}
  @media(prefers-color-scheme:dark){.aviso{background:#2a1f0f;color:#fbbf24}}
  .cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}
  .card{background:#fff;border:1px solid #e2e6eb;border-radius:8px;padding:12px 16px;min-width:120px}
  @media(prefers-color-scheme:dark){.card{background:#1a1f27;border-color:#2b323c}}
  .card b{display:block;font-size:22px}
  .wrap{overflow-x:auto;background:#fff;border:1px solid #e2e6eb;border-radius:8px}
  @media(prefers-color-scheme:dark){.wrap{background:#1a1f27;border-color:#2b323c}}
  table{border-collapse:collapse;width:100%;min-width:900px}
  th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #eceff3;vertical-align:top}
  @media(prefers-color-scheme:dark){th,td{border-color:#262c35}}
  th{background:#f0f2f5;font-size:12px;text-transform:uppercase;letter-spacing:.04em;position:sticky;top:0}
  @media(prefers-color-scheme:dark){th{background:#222831}}
  .sc{font-weight:700;text-align:center;width:44px}
  .nb{white-space:nowrap}
  .obj{max-width:520px}
  .kw{margin-top:6px}
  .kw span{display:inline-block;background:#e0edff;color:#1d4ed8;border-radius:10px;padding:1px 8px;font-size:11px;margin:2px 4px 0 0}
  @media(prefers-color-scheme:dark){.kw span{background:#1e3a5f;color:#93c5fd}}
  .vazio{padding:32px;text-align:center;color:#6b7684}
</style>
</head>
<body>
<h1>Radar de Editais PNCP — Eletrium</h1>
<div class="meta">Gerado em ${esc(new Date(store.geradoEm).toLocaleString("pt-BR"))} ·
  modo <b>${esc(store.modo)}</b> · janela de ${esc(store.janelaDias)} dias · fonte: PNCP (API pública de consultas)</div>

<div class="aviso"><b>Critérios provisórios.</b> Este radar usa palavras-chave e faixas
<b>placeholder</b>, derivadas apenas do ramo elétrico conhecido. Eles <b>não</b> refletem o
perfil real de licitações da Eletrium. Substituir pelos critérios da <b>Seção 4</b> de
<code>Perfil_Eletrium_Licitacoes.md</code> assim que o documento for fornecido.</div>

<div class="cards">
  <div class="card"><b>${esc(store.totalEditais)}</b>editais no radar</div>
  <div class="card"><b>${esc(store.estatisticasUltimaExecucao.novosNestaExecucao)}</b>novos nesta execução</div>
  <div class="card"><b>${esc(store.estatisticasUltimaExecucao.totalRegistrosApi)}</b>registros varridos na API</div>
</div>

<div class="wrap">
${store.editais.length === 0
  ? '<div class="vazio">Nenhum edital relevante encontrado com os critérios atuais.</div>'
  : `<table>
<thead><tr><th>Score</th><th>Objeto</th><th>Órgão / Local</th><th>Valor estimado</th><th>Encerra em</th><th>Link</th></tr></thead>
<tbody>
${linhas}
</tbody></table>`}
</div>

<script type="application/json" id="dados">
${JSON.stringify(store).replace(/</g, "\\u003c")}
</script>
</body>
</html>`;
}

/* ------------------------------- Main ---------------------------------- */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return ajuda();

  const cfg = { ...CONFIG };
  if (args.modo) {
    if (!["proposta", "publicacao"].includes(args.modo)) {
      console.error(`Modo inválido: "${args.modo}". Use "proposta" ou "publicacao".`);
      process.exitCode = 2;
      return;
    }
    cfg.MODO = args.modo;
  }
  if (Number.isFinite(args.dias) && args.dias > 0) cfg.JANELA_DIAS = args.dias;
  if (Number.isFinite(args.maxPaginas) && args.maxPaginas > 0) cfg.MAX_PAGINAS = args.maxPaginas;
  if (args.uf) cfg.UFS_PRIORITARIAS = args.uf.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const dirSaida = args.saida ? path.resolve(args.saida) : cfg.DIR_SAIDA;

  // A API limita /publicacao a 365 dias de intervalo.
  if (cfg.MODO === "publicacao" && cfg.JANELA_DIAS > 365) {
    console.warn("aviso: modo publicacao aceita no máximo 365 dias — ajustando para 365.");
    cfg.JANELA_DIAS = 365;
  }

  console.log("=".repeat(72));
  console.log("RADAR DE EDITAIS PNCP — ELETRIUM");
  console.log("=".repeat(72));
  console.log("!! CRITÉRIOS PROVISÓRIOS: placeholder do ramo elétrico, NÃO o perfil real.");
  console.log("!! Substituir pela Seção 4 de Perfil_Eletrium_Licitacoes.md (não fornecida).");
  console.log("-".repeat(72));
  console.log(`modo: ${cfg.MODO} | janela: ${cfg.JANELA_DIAS} dias | página: ${TAMANHO_PAGINA} reg.`);
  console.log(`palavras-chave (${cfg.PALAVRAS_CHAVE.length}): ${cfg.PALAVRAS_CHAVE.join(", ")}`);
  console.log(`faixa de valor: ${cfg.VALOR_MIN == null && cfg.VALOR_MAX == null ? "sem filtro" : `${cfg.VALOR_MIN ?? "-∞"} a ${cfg.VALOR_MAX ?? "+∞"}`}`);
  console.log(`UFs: ${cfg.UFS_PRIORITARIAS.length ? cfg.UFS_PRIORITARIAS.join(", ") : "todas (sem filtro)"}`);
  if (cfg.MAX_PAGINAS) console.log(`LIMITE: no máximo ${cfg.MAX_PAGINAS} páginas por consulta (varredura parcial)`);
  console.log("-".repeat(72));

  const stats = {
    totalRegistrosApi: 0,
    registrosRecebidos: 0,
    duplicadosDescartados: 0,
    registrosUnicos: 0,
    reprovadosPalavraChave: 0,
    passaramPalavraChave: 0,
    reprovadosUf: 0,
    passaramUf: 0,
    reprovadosValor: 0,
    passaramValor: 0,
    semValorInformado: 0,
    reprovadosScore: 0,
    relevantes: 0,
    paginasLidas: 0,
    varreduraTruncada: false,
  };

  // Combinações a varrer. No modo publicacao a modalidade é obrigatória.
  const modalidades =
    cfg.MODALIDADES != null
      ? cfg.MODALIDADES
      : cfg.MODO === "publicacao"
      ? cfg.MODALIDADES_PADRAO_PUBLICACAO
      : [null];
  const ufs = cfg.UFS_PRIORITARIAS.length ? cfg.UFS_PRIORITARIAS : [null];

  const brutos = [];
  console.log("Consultando o PNCP...");
  for (const modalidade of modalidades) {
    for (const uf of ufs) {
      brutos.push(...(await varrer(cfg, { modalidade, uf }, stats)));
    }
  }
  stats.registrosRecebidos = brutos.length;

  // Deduplicação por numeroControlePNCP (o mesmo edital pode aparecer em mais
  // de uma combinação de consulta e em páginas que se sobrepõem).
  const vistos = new Set();
  const unicos = [];
  for (const r of brutos) {
    const id = r.numeroControlePNCP;
    if (!id) { unicos.push(r); continue; }
    if (vistos.has(id)) { stats.duplicadosDescartados++; continue; }
    vistos.add(id);
    unicos.push(r);
  }
  stats.registrosUnicos = unicos.length;

  const aprovados = filtrar(unicos, cfg, stats);
  stats.relevantes = aprovados.length;

  const res = salvar(aprovados, cfg, stats, dirSaida);

  console.log("-".repeat(72));
  console.log("FUNIL DE FILTRAGEM");
  console.log(`  registros informados pela API .......... ${stats.totalRegistrosApi}`);
  console.log(`  páginas lidas ......................... ${stats.paginasLidas}${stats.varreduraTruncada ? "  (VARREDURA PARCIAL — --max-paginas)" : ""}`);
  console.log(`  registros recebidos ................... ${stats.registrosRecebidos}`);
  console.log(`  duplicados descartados ................ ${stats.duplicadosDescartados}`);
  console.log(`  registros únicos analisados ........... ${stats.registrosUnicos}`);
  console.log(`  - reprovados por palavra-chave ........ ${stats.reprovadosPalavraChave}`);
  console.log(`  = passaram por palavra-chave .......... ${stats.passaramPalavraChave}`);
  console.log(`  - reprovados por UF ................... ${stats.reprovadosUf}`);
  console.log(`  = passaram por UF ..................... ${stats.passaramUf}`);
  console.log(`  - reprovados por valor ................ ${stats.reprovadosValor}`);
  console.log(`  = passaram por valor .................. ${stats.passaramValor}   (sem valor informado: ${stats.semValorInformado})`);
  console.log(`  - reprovados por score mínimo ......... ${stats.reprovadosScore}`);
  console.log(`  >> RELEVANTES ......................... ${stats.relevantes}`);
  console.log("-".repeat(72));
  console.log(`store: ${res.total} editais (${res.novos} novos, ${res.atualizados} atualizados)`);
  console.log(`  JSON: ${res.arqJson}`);
  console.log(`  HTML: ${res.arqHtml}`);

  if (stats.relevantes === 0) {
    console.log("\nNenhum edital relevante nesta janela. Isso é um resultado válido —");
    console.log("mas lembre que as palavras-chave ainda são PLACEHOLDER (Seção 4 pendente).");
  }
  if (stats.varreduraTruncada) {
    console.log("\nATENÇÃO: varredura PARCIAL (--max-paginas). Rode sem o limite para cobertura total.");
  }
  console.log("=".repeat(72));
}

// Só executa quando chamado direto pela CLI. Assim o arquivo pode ser
// importado (require) para testar as funções puras sem disparar consultas.
if (require.main === module) {
  main().catch((e) => {
    // Nada de stack trace cru para o operador.
    console.error("\n[ERRO] " + (e && e.message ? e.message : String(e)));
    if (e && e.semRetry) {
      console.error("Verifique os parâmetros da consulta (datas, modalidade, UF).");
    } else {
      console.error("Se o PNCP estiver instável, tente novamente em alguns minutos.");
    }
    process.exitCode = 1;
  });
}

module.exports = { CONFIG, normalizar, squash, casaPalavraChave, avaliar, filtrar, linkPncp };
