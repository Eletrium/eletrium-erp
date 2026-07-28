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
 *   node pncp-radar.js --uf MG               # RESTRINGE a consulta à(s) UF(s)
 *   node pncp-radar.js --help
 */

"use strict";

const fs = require("fs");
const path = require("path");

/* ══════════════════════════════════════════════════════════════════════════
 *
 *   BLOCO DE CONFIGURAÇÃO — CRITÉRIOS DE RELEVÂNCIA
 *
 *   Fonte: **Seção 4 do Perfil de Licitações da Eletrium** (escopo de serviço,
 *   porte/valor, órgão contratante, qualificação técnica, bônus), fornecida
 *   pelo dono. Os critérios abaixo são a tradução fiel dessa seção.
 *
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │  O QUE AINDA É PROVISÓRIO (declarado pela própria Seção 4):        │
 *   │                                                                    │
 *   │  1. A FAIXA DE VALOR (R$ 5 mil – R$ 500 mil) é "faixa provisória"  │
 *   │     nas palavras do dono.                                          │
 *   │  2. A BANDA R$ 500.001 – R$ 1.000.000 **não é definida** pela      │
 *   │     Seção 4: ela não está na faixa e também não é o gatilho de     │
 *   │     consórcio (~R$ 1 mi). Tratada aqui como NEUTRA — não pontua,   │
 *   │     não descarta. LACUNA A FECHAR COM O DONO.                      │
 *   │  3. O item D (qualificação técnica: atestado compatível, ART em    │
 *   │     10–15 dias, soma de atestados, patrimônio líquido) NÃO é       │
 *   │     automatizável a partir da API de consulta — esses dados estão  │
 *   │     no PDF do edital. Fica como AVALIAÇÃO HUMANA. Nenhuma          │
 *   │     heurística foi inventada para ele.                             │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 *   REGRA DE OURO: valor e UF **classificam**, não cortam. O único corte
 *   automático é: (a) não casar nenhuma palavra-chave de escopo, ou
 *   (b) bater num TERMO DE EXCLUSÃO — e toda exclusão é registrada com
 *   motivo rastreável (nada é descartado em silêncio).
 *
 * ══════════════════════════════════════════════════════════════════════════ */

const CONFIG = {
  /* ---------------------------------------------------------------------
   * [Seção 4 — A] ESCOPO DE SERVIÇO: palavras-chave buscadas no objeto.
   * Basta UMA casar (correspondência direta ao objeto do edital).
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
    "spda",              // sistema de proteção contra descargas atmosféricas
    "descarg atmosferic",// "proteção contra descargas atmosféricas" por extenso
    "para raio",         // para-raios
    "nbr 5419",          // norma de SPDA
    "aterrament",        // aterramento / aterramentos
    "nr 12",             // segurança em máquinas e equipamentos
    "nr 10",             // segurança em instalações e serviços em eletricidade
    "nbr 5410",          // instalações elétricas de baixa tensão
    "instalac eletric",  // instalação(ões) elétrica(s)
    "manutenc eletric",  // manutenção elétrica preventiva/corretiva
    "subestac",          // subestação — ver REGRA DE PORTE mais abaixo
    "cabine primari",    // cabine primária (média tensão)
    "laudo eletric",     // laudo elétrico
  ],

  /* ---------------------------------------------------------------------
   * [Seção 4 — E] BÔNUS: se o objeto menciona explicitamente um destes,
   * o edital ganha +1 de score (uma vez só, não por termo).
   * ------------------------------------------------------------------- */
  TERMOS_BONUS: ["spda", "para raio", "nr 12", "nr 10", "aterrament"],

  /* ---------------------------------------------------------------------
   * NÚCLEO DE ESCOPO — sinais que provam que o edital tem componente
   * elétrico REAL (não uma menção de passagem). Usado para "resgatar" um
   * edital de regras de exclusão marcadas como `resgatavelPorNucleo`.
   *
   * Repare que "instalac eletric", "manutenc eletric" e "subestac" NÃO estão
   * aqui de propósito: são justamente os termos que aparecem de passagem em
   * contratos de facilities e em obras civis maiores.
   * ------------------------------------------------------------------- */
  SINAIS_ESCOPO_NUCLEO: [
    "spda", "descarg atmosferic", "para raio", "nbr 5419", "aterrament",
    "nr 12", "nr 10", "nbr 5410", "cabine primari", "laudo eletric",
  ],

  /* ---------------------------------------------------------------------
   * [Seção 4 — B] PORTE/VALOR sobre `valorTotalEstimado`.
   * NÃO É FILTRO DE CORTE — é CLASSIFICAÇÃO:
   *
   *   valor < 5.000 ................... "abaixo da faixa"   (sem bônus)
   *   5.000 a 500.000 ................. "na faixa"          (+1 de score)
   *   500.001 a 1.000.000 ............. "acima da faixa"    (NEUTRO — lacuna)
   *   > 1.000.000 ..................... "avaliar consórcio" (não descarta)
   *   sem valor informado ............. "valor não informado" (não descarta)
   *
   * ⚠️ A faixa é PROVISÓRIA (declarado na própria Seção 4).
   * ------------------------------------------------------------------- */
  VALOR_FAIXA_MIN: 5000,
  VALOR_FAIXA_MAX: 500000,
  VALOR_CONSORCIO: 1000000,

  /* ---------------------------------------------------------------------
   * [Seção 4 — C] ÓRGÃO CONTRATANTE / GEOGRAFIA.
   * NÃO É FILTRO DE CORTE — é CLASSIFICAÇÃO:
   *   UF em UFS_PRIORITARIAS -> "prioritário"        (+2 de score)
   *   fora                   -> "avaliar logística"  (sem bônus, sem descarte)
   *
   * A Seção 4 também cita autarquias, fundações e empresas públicas — todas
   * elas já estão dentro do universo do PNCP, então não há filtro adicional
   * de natureza jurídica aqui (a esfera vem em `orgaoEntidade.esferaId` e é
   * registrada no store para triagem humana).
   * ------------------------------------------------------------------- */
  UFS_PRIORITARIAS: ["MG"],

  /* ---------------------------------------------------------------------
   * ESCOPO DA CONSULTA (operacional, NÃO é critério de negócio).
   * Lista vazia = consulta o Brasil inteiro. Preencher (ou usar --uf) só
   * para rodar mais rápido; isso REDUZ a cobertura, não a prioridade.
   * ------------------------------------------------------------------- */
  UFS_CONSULTA: [],

  /* ---------------------------------------------------------------------
   * REGRA DE PORTE DA SUBESTAÇÃO — resolve o conflito da Seção 4.
   *
   * "subestac" é palavra-chave de INCLUSÃO (trouxe os melhores resultados do
   * teste real), mas a Seção 4 exclui "alta tensão / subestações de GRANDE
   * PORTE". Nem toda subestação é de grande porte. Regra adotada:
   *
   *   1. tensão em kV explícita ACIMA de TENSAO_KV_LIMITE  -> EXCLUI
   *      (ex.: 69 kV, 138 kV, 230 kV = transmissão/alta tensão)
   *   2. termo explícito de alta tensão/transmissão        -> EXCLUI
   *      (ver regra "alta-tensao" em REGRAS_EXCLUSAO)
   *   3. tensão em kV explícita ATÉ o limite               -> MANTÉM
   *      (13,8 / 15 / 23 / 34,5 kV = média tensão = cabine primária, que a
   *       própria Eletrium lista como escopo)
   *   4. subestação SEM tensão informada                   -> MANTÉM + ALERTA
   *      (não se descarta por omissão do órgão; vai para avaliação humana)
   *
   * "kVA" (potência) é ignorado de propósito — não é tensão.
   *
   * ⚠️ DIVERGÊNCIA DELIBERADA E DOCUMENTADA: o dono sugeriu tratar a frase
   * "subestação de energia" como sinal de grande porte. NÃO foi adotada como
   * sinal isolado, porque ela casa com subestações de 15 kV — que são cabine
   * primária, escopo declarado da Eletrium. Para adotar a sugestão do dono,
   * basta trocar SUBESTACAO_SEM_TENSAO_INFORMADA para "excluir" (aí toda
   * subestação sem tensão declarada cai fora).
   * ------------------------------------------------------------------- */
  TENSAO_KV_LIMITE: 34.5,
  SUBESTACAO_SEM_TENSAO_INFORMADA: "sinalizar", // "sinalizar" | "excluir"

  /* ---------------------------------------------------------------------
   * TERMOS DE EXCLUSÃO — um edital que casa palavra-chave mas bate aqui é
   * REPROVADO **com motivo registrado** (console + JSON `motivoDescarte`).
   *
   * Campos de cada regra:
   *   id / motivo         .... rastreabilidade no relatório e no JSON
   *   termos              .... radicais, mesmo esquema das palavras-chave
   *   minimoTermos        .... quantos termos DISTINTOS precisam casar.
   *                            2 = exige que a categoria seja dominante no
   *                            objeto (evita matar edital por 1 palavra solta)
   *   resgatavelPorNucleo .... se true, a presença de um SINAL_ESCOPO_NUCLEO
   *                            (SPDA, aterramento, NR-10/12, NBR 5410/5419…)
   *                            cancela a exclusão. É assim que a Seção 4
   *                            diz "…SEM componente elétrico".
   *
   * IMPORTANTE: exclusão usa APENAS o match por radical com fronteira de
   * palavra — sem o match "colado" (squash) da inclusão. Sem isso, "curso"
   * casaria dentro de "con-curso" e mataria editais legítimos.
   * ------------------------------------------------------------------- */
  REGRAS_EXCLUSAO: [
    {
      // FALSO POSITIVO JÁ OBSERVADO: "Pós-graduação em Instalações Elétricas".
      id: "ensino",
      motivo: "objeto de ensino/capacitação — é curso, não serviço de engenharia",
      termos: [
        "curso", "treinament", "capacitac", "pos graduac", "workshop",
        "palestra", "seminari", "material didatic", "apostila", "instrutor",
      ],
      minimoTermos: 1,
      resgatavelPorNucleo: false, // um curso SOBRE SPDA continua sendo um curso
    },
    {
      // FALSO POSITIVO JÁ OBSERVADO: contrato de facilities que cita
      // "manutenção elétrica" no meio de limpeza, portaria e copeiragem.
      id: "facilities",
      motivo: "contrato de facilities/terceirização de mão de obra — a menção elétrica é acessória",
      termos: [
        "limpez", "portari", "copeiragem", "conservac", "jardinagem",
        "recepcao", "recepcionist", "vigilanc", "asseio", "zeladoria",
        "terceirizac", "auxiliar de servic", "posto de trabalh",
      ],
      minimoTermos: 2,          // 2+ = é mesmo um contrato de facilities
      resgatavelPorNucleo: true, // SPDA/aterramento/NR = serviço técnico de verdade
    },
    {
      id: "alta-tensao",
      motivo: "alta tensão / transmissão — fora do escopo (Seção 4)",
      termos: ["alta tensa", "linha de transmissa", "subestac de transmissa", "extra alta"],
      minimoTermos: 1,
      resgatavelPorNucleo: false,
    },
    {
      id: "geracao",
      motivo: "geração de energia — fora do escopo (Seção 4)",
      termos: [
        "gerac de energia", "usina hidreletric", "usina termeletric",
        "usina fotovoltaic", "hidreletric", "termeletric", "parque eolic",
        "central geradora", "sistema fotovoltaic", "energia solar fotovoltaic",
      ],
      minimoTermos: 1,
      resgatavelPorNucleo: true,
    },
    {
      id: "obra-civil",
      motivo: "obra civil / engenharia estrutural sem componente elétrico (Seção 4)",
      termos: [
        "obra civ", "engenharia estrutural", "calculo estrutural",
        "reforco estrutural", "muro de arrimo", "terraplanagem",
        "pavimentac asfaltic", "recapeament", "drenagem pluvial", "calcament",
      ],
      minimoTermos: 2,
      resgatavelPorNucleo: true,
    },
    {
      id: "ti-redes",
      motivo: "TI / rede de dados sem componente elétrico associado (Seção 4)",
      termos: [
        "rede logic", "rede de dados", "cabeamento estruturad", "fibra optic",
        "data center", "datacenter", "cpd", "link de internet", "software",
        "licenc de uso",
      ],
      minimoTermos: 2,
      resgatavelPorNucleo: true,
    },
  ],

  /* ---------------------------------------------------------------------
   * Score mínimo para um edital entrar no radar.
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
  --uf <MG,SP>                  RESTRINGE a consulta a essas UFs (cobertura menor,
                                execução mais rápida). Não muda a prioridade:
                                a prioridade geográfica é sempre ${CONFIG.UFS_PRIORITARIAS.join(", ")}.
  --saida <dir>                 diretório de saída (padrão ./pncp-radar-data)
  --help

CRITÉRIOS (Seção 4 do Perfil de Licitações da Eletrium)

  CORTA (com motivo registrado, nunca em silêncio):
    - nenhuma palavra-chave de escopo no objeto
    - termo de exclusão: ensino/curso, facilities/terceirização, alta tensão,
      geração de energia, obra civil pura, TI/rede de dados

  CLASSIFICA (não corta):
    - valor: <5k "abaixo da faixa" | 5k–500k "na faixa" | 500k–1mi "acima da
      faixa" (NEUTRO, lacuna da Seção 4) | >1mi "avaliar consórcio" |
      sem valor "valor não informado"
    - UF: ${CONFIG.UFS_PRIORITARIAS.join(", ")} "prioritário" | demais "avaliar logística"

  FÓRMULA DO SCORE (aditiva):
    score = nº de palavras-chave DISTINTAS no objeto
          + 2  se a UF é prioritária (${CONFIG.UFS_PRIORITARIAS.join(", ")})
          + 1  se o valor está na faixa (R$ ${CONFIG.VALOR_FAIXA_MIN} – ${CONFIG.VALOR_FAIXA_MAX})
          + 1  se menciona termo de bônus (${CONFIG.TERMOS_BONUS.join(", ")})
    entra no radar quem tiver >= 1 palavra-chave e score >= ${CONFIG.SCORE_MINIMO}.

  PROVISÓRIO: a faixa de valor (a própria Seção 4 diz isso) e a banda
  R$ 500.001–1.000.000, que a Seção 4 não define (tratada como neutra).
  NÃO AUTOMATIZÁVEL: item D (atestado, ART, patrimônio líquido) — está no PDF
  do edital, não na API. Fica como avaliação humana.
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

/**
 * Match para TERMOS DE EXCLUSÃO: só o radical com fronteira de palavra —
 * SEM o atalho "colado" (squash) usado na inclusão.
 *
 * Motivo concreto: squash("curso") = "curso", que está contido em "concurso".
 * Usar squash aqui reprovaria qualquer edital com a palavra "concurso".
 * Exclusão é irreversível para o edital, então exige o match mais estrito.
 */
function casaTermoExclusao(termo, textoNorm) {
  return regexDoTermo(termo).test(textoNorm);
}

/** Lista dos termos de uma lista que aparecem no texto (match estrito). */
function termosPresentes(termos, textoNorm) {
  return termos.filter((t) => casaTermoExclusao(t, textoNorm));
}

/**
 * Extrai TENSÕES em kV citadas no texto. Usada pela regra de porte da
 * subestação. Trabalha sobre o texto quase cru (só minúsculas/sem acento)
 * porque normalizar() transformaria "13,8 kV" em "13 8 kv", destruindo o
 * decimal. Ignora "kVA" (potência, não tensão) via lookahead.
 *   "138kV" -> [138]   "13,8 kV" -> [13.8]   "75KVA" -> []
 */
function tensoesEmKv(texto) {
  const t = String(texto == null ? "" : texto)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const re = /(\d{1,4}(?:[.,]\d{1,2})?)\s*k\s*v(?![a-z])/g;
  const out = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    const v = Number(m[1].replace(",", "."));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
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
 *         + 2  se a UF do órgão é prioritária (Seção 4 C: MG)
 *         + 1  se valorTotalEstimado está na faixa (Seção 4 B: 5k–500k)
 *         + 1  se o objeto menciona um TERMO_BONUS (Seção 4 E)
 *
 * Texto analisado = objetoCompra + informacaoComplementar (normalizados).
 * Entra no radar quem tiver >= 1 palavra-chave, NÃO bater em termo de
 * exclusão, e score >= SCORE_MINIMO.
 * ---------------------------------------------------------------------- */

/** Rótulos de classificação (não são cortes — são etiquetas de triagem). */
const FAIXA = {
  ABAIXO: "abaixo da faixa",
  NA: "na faixa",
  ACIMA: "acima da faixa",
  CONSORCIO: "avaliar consórcio",
  SEM: "valor não informado",
};
const GEO = {
  PRIORITARIO: "prioritário",
  LOGISTICA: "avaliar logística",
  SEM: "UF não informada",
};

/** [Seção 4 B] Classifica o porte pelo valor. NUNCA descarta. */
function classificarValor(valor, cfg) {
  if (valor == null) return FAIXA.SEM;
  if (valor > cfg.VALOR_CONSORCIO) return FAIXA.CONSORCIO;
  if (valor < cfg.VALOR_FAIXA_MIN) return FAIXA.ABAIXO;
  if (valor <= cfg.VALOR_FAIXA_MAX) return FAIXA.NA;
  // Banda 500.001–1.000.000: a Seção 4 NÃO define. Neutra: não pontua,
  // não descarta. Lacuna registrada no README para o dono fechar.
  return FAIXA.ACIMA;
}

/** [Seção 4 C] Classifica a geografia. NUNCA descarta. */
function classificarUf(uf, cfg) {
  if (!uf) return GEO.SEM;
  return cfg.UFS_PRIORITARIAS.includes(uf) ? GEO.PRIORITARIO : GEO.LOGISTICA;
}

/**
 * Regra de porte da subestação / alta tensão.
 * Devolve { exclusao?, alerta? } — ver o comentário do bloco CONFIG.
 */
function avaliarPorteEletrico(cfg, tNorm, textoCru, encontradas) {
  const tensoes = tensoesEmKv(textoCru);
  const altas = tensoes.filter((v) => v > cfg.TENSAO_KV_LIMITE);

  if (altas.length > 0) {
    return {
      tensoesKv: tensoes,
      exclusao: {
        regra: "porte-alta-tensao",
        motivo: `alta tensão: ${altas.join(", ")} kV (acima de ${cfg.TENSAO_KV_LIMITE} kV) — fora do escopo (Seção 4)`,
        termos: altas.map((v) => `${v} kV`),
      },
    };
  }

  const temSubestacao = encontradas.includes("subestac");
  if (!temSubestacao) return { tensoesKv: tensoes };

  if (tensoes.length > 0) {
    return {
      tensoesKv: tensoes,
      alerta: `subestação de média/baixa tensão (${tensoes.join(", ")} kV) — dentro do escopo`,
    };
  }

  if (cfg.SUBESTACAO_SEM_TENSAO_INFORMADA === "excluir") {
    return {
      tensoesKv: tensoes,
      exclusao: {
        regra: "porte-subestacao",
        motivo: "subestação sem tensão informada e SUBESTACAO_SEM_TENSAO_INFORMADA=excluir",
        termos: ["subestac"],
      },
    };
  }

  return {
    tensoesKv: tensoes,
    alerta: "subestação SEM tensão informada — verificar porte no edital (não dá para decidir pela API)",
  };
}

/** Aplica as REGRAS_EXCLUSAO. Devolve a 1ª que bate, ou null. */
function avaliarExclusaoPorTermos(cfg, tNorm, temNucleo) {
  for (const regra of cfg.REGRAS_EXCLUSAO) {
    const casados = termosPresentes(regra.termos, tNorm);
    if (casados.length < (regra.minimoTermos || 1)) continue;
    if (regra.resgatavelPorNucleo && temNucleo) continue; // tem componente elétrico real
    return { regra: regra.id, motivo: regra.motivo, termos: casados };
  }
  return null;
}

function avaliar(reg, cfg) {
  const texto = [reg.objetoCompra, reg.informacaoComplementar].filter(Boolean).join(" ");
  const tNorm = normalizar(texto);
  const tSquash = squash(texto);

  const encontradas = cfg.PALAVRAS_CHAVE.filter((k) => casaPalavraChave(k, tNorm, tSquash));
  const nucleo = cfg.SINAIS_ESCOPO_NUCLEO.filter((k) => casaPalavraChave(k, tNorm, tSquash));
  const bonus = cfg.TERMOS_BONUS.filter((k) => casaPalavraChave(k, tNorm, tSquash));

  const uf = reg.unidadeOrgao?.ufSigla || reg.unidadeSubRogada?.ufSigla || null;
  const valor = typeof reg.valorTotalEstimado === "number" ? reg.valorTotalEstimado : null;

  const classificacaoUf = classificarUf(uf, cfg);
  const faixaValor = classificarValor(valor, cfg);
  const ufPrioritaria = classificacaoUf === GEO.PRIORITARIO;
  const valorNaFaixa = faixaValor === FAIXA.NA;

  // Exclusões só fazem sentido para quem já casou o escopo.
  let exclusao = null;
  const alertas = [];
  let tensoesKv = [];
  if (encontradas.length > 0) {
    const porte = avaliarPorteEletrico(cfg, tNorm, texto, encontradas);
    tensoesKv = porte.tensoesKv || [];
    if (porte.alerta) alertas.push(porte.alerta);
    exclusao = porte.exclusao || avaliarExclusaoPorTermos(cfg, tNorm, nucleo.length > 0);
  }

  if (faixaValor === FAIXA.CONSORCIO) {
    alertas.push("valor acima de R$ 1 mi — avaliar consórcio (Seção 4 B)");
  }
  if (classificacaoUf === GEO.LOGISTICA) {
    alertas.push("fora de MG — avaliar logística (Seção 4 C)");
  }
  if (faixaValor === FAIXA.ACIMA) {
    alertas.push("faixa R$ 500 mil–1 mi NÃO é definida pela Seção 4 — classificado como neutro");
  }

  let score = encontradas.length;
  if (ufPrioritaria) score += 2;
  if (valorNaFaixa) score += 1;
  if (bonus.length > 0) score += 1;

  return {
    encontradas, nucleo, bonus, uf, valor,
    classificacaoUf, faixaValor, ufPrioritaria, valorNaFaixa,
    tensoesKv, alertas, exclusao, score,
  };
}

/** Campos comuns a aprovados e descartados — mesma visão do edital. */
function projetar(reg, a) {
  return {
    numeroControlePNCP: reg.numeroControlePNCP,
    modalidade: reg.modalidadeNome,
    situacao: reg.situacaoCompraNome,
    objeto: reg.objetoCompra,
    orgao: reg.orgaoEntidade?.razaoSocial || null,
    cnpjOrgao: reg.orgaoEntidade?.cnpj || null,
    esferaOrgao: reg.orgaoEntidade?.esferaId || null,
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
  };
}

/**
 * Aplica os filtros em cascata, contando as baixas em cada etapa.
 * Devolve { aprovados, descartados } — descartados carregam `motivoDescarte`,
 * porque a regra é NUNCA descartar em silêncio.
 */
function filtrar(registros, cfg, stats) {
  const aprovados = [];
  const descartados = [];

  for (const reg of registros) {
    const a = avaliar(reg, cfg);

    if (a.encontradas.length === 0) { stats.reprovadosPalavraChave++; continue; }
    stats.passaramPalavraChave++;

    // TERMOS DE EXCLUSÃO — único corte novo. Sempre com motivo rastreável.
    if (a.exclusao) {
      stats.reprovadosExclusao++;
      stats.porRegraExclusao[a.exclusao.regra] = (stats.porRegraExclusao[a.exclusao.regra] || 0) + 1;
      descartados.push({
        ...projetar(reg, a),
        regraDescarte: a.exclusao.regra,
        motivoDescarte: a.exclusao.motivo,
        termosDescarte: a.exclusao.termos,
      });
      continue;
    }
    stats.passaramExclusao++;

    // UF e VALOR **classificam**, não cortam (Seção 4 B e C).
    stats.classificacaoUf[a.classificacaoUf] = (stats.classificacaoUf[a.classificacaoUf] || 0) + 1;
    stats.faixaValor[a.faixaValor] = (stats.faixaValor[a.faixaValor] || 0) + 1;

    if (a.score < cfg.SCORE_MINIMO) {
      stats.reprovadosScore++;
      descartados.push({
        ...projetar(reg, a),
        regraDescarte: "score-minimo",
        motivoDescarte: `score ${a.score} abaixo do mínimo ${cfg.SCORE_MINIMO}`,
        termosDescarte: [],
      });
      continue;
    }

    aprovados.push({
      ...projetar(reg, a),
      classificacaoUf: a.classificacaoUf,
      faixaValor: a.faixaValor,
      tensoesKv: a.tensoesKv,
      alertas: a.alertas,
      avaliacaoHumanaPendente: AVALIACAO_HUMANA,
    });
  }

  return { aprovados, descartados };
}

/**
 * [Seção 4 D] Qualificação técnica NÃO é automatizável: atestado compatível,
 * ART em 10–15 dias, soma de atestados e patrimônio líquido estão no PDF do
 * edital, não na API de consulta. Vai anexado a cada edital como lembrete
 * explícito de que a triagem final é humana — em vez de fingir heurística.
 */
const AVALIACAO_HUMANA = [
  "atestado técnico compatível (SPDA/NBR 5419 ou instalação NBR 5410/NR-10)",
  "prazo de ART após assinatura (alvo: 10–15 dias)",
  "admite soma de atestados?",
  "patrimônio líquido exigido (não avaliável hoje)",
  "prazo de execução compatível sem consórcio (Seção 4 E)",
];

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
function salvar(aprovados, descartados, cfg, stats, dirSaida) {
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

  // Um edital que JÁ ESTAVA no radar e agora bate num termo de exclusão sai do
  // radar — senão o store cumulativo eternizaria aprovações de um critério
  // antigo. A saída é registrada com motivo (nunca some em silêncio).
  const removidosDoRadar = [];
  for (const d of descartados) {
    const antigo = indice.get(d.numeroControlePNCP);
    if (!antigo) continue;
    indice.delete(d.numeroControlePNCP);
    removidosDoRadar.push({
      ...antigo,
      regraDescarte: d.regraDescarte,
      motivoDescarte: d.motivoDescarte,
      termosDescarte: d.termosDescarte,
      removidoEm: agora,
    });
  }

  const editais = [...indice.values()].sort(
    (a, b) => b.score - a.score || String(a.dataEncerramentoProposta).localeCompare(String(b.dataEncerramentoProposta))
  );

  const store = {
    geradoEm: agora,
    fonte: "PNCP — API pública de consultas (https://pncp.gov.br/api/consulta/v1)",
    modo: cfg.MODO,
    janelaDias: cfg.JANELA_DIAS,
    origemCriterios:
      "Seção 4 do Perfil de Licitações da Eletrium (escopo de serviço, porte/valor, " +
      "órgão contratante, qualificação técnica, bônus).",
    AVISO_PROVISORIO: [
      "A FAIXA DE VALOR (R$ 5.000–500.000) é provisória — declarado na própria Seção 4.",
      "A banda R$ 500.001–1.000.000 NÃO é definida pela Seção 4: tratada como NEUTRA " +
        "(não pontua, não descarta). Lacuna a fechar com o dono.",
      "Seção 4 D (atestado técnico, ART, soma de atestados, patrimônio líquido) NÃO é " +
        "automatizável pela API — permanece como AVALIAÇÃO HUMANA (campo avaliacaoHumanaPendente).",
    ],
    criteriosUsados: {
      PALAVRAS_CHAVE: cfg.PALAVRAS_CHAVE,
      TERMOS_BONUS: cfg.TERMOS_BONUS,
      SINAIS_ESCOPO_NUCLEO: cfg.SINAIS_ESCOPO_NUCLEO,
      VALOR_FAIXA_MIN: cfg.VALOR_FAIXA_MIN,
      VALOR_FAIXA_MAX: cfg.VALOR_FAIXA_MAX,
      VALOR_CONSORCIO: cfg.VALOR_CONSORCIO,
      UFS_PRIORITARIAS: cfg.UFS_PRIORITARIAS,
      TENSAO_KV_LIMITE: cfg.TENSAO_KV_LIMITE,
      SUBESTACAO_SEM_TENSAO_INFORMADA: cfg.SUBESTACAO_SEM_TENSAO_INFORMADA,
      REGRAS_EXCLUSAO: cfg.REGRAS_EXCLUSAO.map((r) => ({
        id: r.id, motivo: r.motivo, minimoTermos: r.minimoTermos,
        resgatavelPorNucleo: r.resgatavelPorNucleo, termos: r.termos,
      })),
      SCORE_MINIMO: cfg.SCORE_MINIMO,
      formulaScore:
        "score = nº de palavras-chave distintas + 2 (UF prioritária) " +
        "+ 1 (valor na faixa) + 1 (menciona termo de bônus da Seção 4 E)",
      regraSubestacao:
        `subestação NÃO é excluída por si. Exclui só com sinal objetivo de grande porte: ` +
        `tensão > ${cfg.TENSAO_KV_LIMITE} kV ou termo explícito de alta tensão/transmissão. ` +
        `Média tensão (13,8/15/23/34,5 kV) fica — é cabine primária, escopo da Eletrium. ` +
        `Sem tensão informada: ${cfg.SUBESTACAO_SEM_TENSAO_INFORMADA} (padrão "sinalizar", nunca descarta em silêncio).`,
      naoAutomatizavel: AVALIACAO_HUMANA,
    },
    estatisticasUltimaExecucao: { ...stats, novosNestaExecucao: novos, atualizadosNestaExecucao: atualizados },
    totalEditais: editais.length,
    editais,
    // Não é cumulativo de propósito: retrato da ÚLTIMA execução, para o dono
    // auditar o que o filtro derrubou e por quê.
    descartadosUltimaExecucao: descartados,
    // Editais que estavam no radar e SAÍRAM porque passaram a bater num termo
    // de exclusão (mudança de critério). Auditoria da própria mudança.
    removidosDoRadarNestaExecucao: removidosDoRadar,
  };

  fs.writeFileSync(arqJson, JSON.stringify(store, null, 2), "utf8");
  fs.writeFileSync(arqHtml, gerarHtml(store), "utf8");

  return { arqJson, arqHtml, novos, atualizados, removidos: removidosDoRadar, total: editais.length };
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
  const classeFaixa = (f) =>
    f === "na faixa" ? "ok" : f === "avaliar consórcio" || f === "acima da faixa" ? "warn" : "mute";

  const linhas = store.editais
    .map(
      (e) => `<tr>
      <td class="sc">${esc(e.score)}</td>
      <td><div class="obj">${esc(e.objeto)}</div>
          <div class="kw">${(e.palavrasChave || []).map((k) => `<span>${esc(k)}</span>`).join("")}</div>
          ${(e.alertas || []).length ? `<div class="al">${e.alertas.map((x) => `<span>⚠ ${esc(x)}</span>`).join("")}</div>` : ""}</td>
      <td>${esc(e.orgao || "—")}<br><small>${esc(e.municipio || "—")}/${esc(e.uf || "—")}</small>
          <br><span class="tag ${e.classificacaoUf === "prioritário" ? "ok" : "mute"}">${esc(e.classificacaoUf || "—")}</span></td>
      <td class="nb">${esc(brl(e.valorTotalEstimado))}
          <br><span class="tag ${classeFaixa(e.faixaValor)}">${esc(e.faixaValor || "—")}</span></td>
      <td class="nb">${esc(dataBr(e.dataEncerramentoProposta))}</td>
      <td class="nb">${e.linkPncp ? `<a href="${esc(e.linkPncp)}" target="_blank" rel="noopener">PNCP</a>` : "—"}</td>
    </tr>`
    )
    .join("\n");

  const descartados = store.descartadosUltimaExecucao || [];
  const linhasDescarte = descartados
    .map(
      (e) => `<tr>
      <td class="nb"><span class="tag warn">${esc(e.regraDescarte)}</span></td>
      <td><div class="obj">${esc(e.objeto)}</div>
          <div class="mot">${esc(e.motivoDescarte)}</div>
          <div class="kw">${(e.termosDescarte || []).map((k) => `<span>${esc(k)}</span>`).join("")}</div></td>
      <td>${esc(e.orgao || "—")}<br><small>${esc(e.municipio || "—")}/${esc(e.uf || "—")}</small></td>
      <td class="nb">${esc(brl(e.valorTotalEstimado))}</td>
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
  .al{margin-top:6px}
  .al span{display:block;font-size:11px;color:#92400e}
  @media(prefers-color-scheme:dark){.al span{color:#fbbf24}}
  .mot{margin-top:6px;font-size:12px;color:#b91c1c}
  @media(prefers-color-scheme:dark){.mot{color:#fca5a5}}
  .tag{display:inline-block;border-radius:10px;padding:1px 8px;font-size:11px;margin-top:4px;white-space:nowrap}
  .tag.ok{background:#dcfce7;color:#166534}
  .tag.warn{background:#fef3c7;color:#92400e}
  .tag.mute{background:#eceff3;color:#4b5563}
  @media(prefers-color-scheme:dark){.tag.ok{background:#14351f;color:#86efac}.tag.warn{background:#3a2c0f;color:#fcd34d}.tag.mute{background:#262c35;color:#9aa4b2}}
  h2{margin:28px 0 10px;font-size:17px}
  .vazio{padding:32px;text-align:center;color:#6b7684}
</style>
</head>
<body>
<h1>Radar de Editais PNCP — Eletrium</h1>
<div class="meta">Gerado em ${esc(new Date(store.geradoEm).toLocaleString("pt-BR"))} ·
  modo <b>${esc(store.modo)}</b> · janela de ${esc(store.janelaDias)} dias · fonte: PNCP (API pública de consultas)</div>

<div class="aviso"><b>Critérios: Seção 4 do Perfil de Licitações da Eletrium.</b>
Valor e UF <b>classificam, não cortam</b> — nada é descartado por porte ou distância.
<b>Provisório:</b> a faixa de valor (R$ 5 mil–500 mil) é declarada provisória pela própria
Seção 4, e a banda <b>R$ 500 mil–1 mi não é definida</b> por ela (tratada como neutra).
<b>Não automatizável:</b> Seção 4 D (atestado técnico, ART, soma de atestados, patrimônio
líquido) — está no PDF do edital, não na API. Continua sendo <b>avaliação humana</b>.</div>

<div class="cards">
  <div class="card"><b>${esc(store.totalEditais)}</b>editais no radar</div>
  <div class="card"><b>${esc(store.estatisticasUltimaExecucao.novosNestaExecucao)}</b>novos nesta execução</div>
  <div class="card"><b>${esc(store.estatisticasUltimaExecucao.reprovadosExclusao)}</b>descartados por exclusão</div>
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

<h2>Descartados nesta execução — com motivo</h2>
<div class="meta">Só entram aqui os editais que <b>casaram uma palavra-chave</b> e mesmo assim
foram reprovados. Serve para auditar o filtro: se algo bom aparecer nesta lista, o critério
precisa de ajuste.</div>
<div class="wrap">
${descartados.length === 0
  ? '<div class="vazio">Nenhum edital foi descartado por termo de exclusão nesta execução.</div>'
  : `<table>
<thead><tr><th>Regra</th><th>Objeto / motivo</th><th>Órgão / Local</th><th>Valor estimado</th><th>Link</th></tr></thead>
<tbody>
${linhasDescarte}
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
  // --uf restringe o ESCOPO DA CONSULTA (operacional). NÃO mexe em
  // UFS_PRIORITARIAS: a prioridade geográfica é critério de negócio (Seção 4 C).
  if (args.uf) cfg.UFS_CONSULTA = args.uf.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const dirSaida = args.saida ? path.resolve(args.saida) : cfg.DIR_SAIDA;

  // A API limita /publicacao a 365 dias de intervalo.
  if (cfg.MODO === "publicacao" && cfg.JANELA_DIAS > 365) {
    console.warn("aviso: modo publicacao aceita no máximo 365 dias — ajustando para 365.");
    cfg.JANELA_DIAS = 365;
  }

  console.log("=".repeat(72));
  console.log("RADAR DE EDITAIS PNCP — ELETRIUM");
  console.log("=".repeat(72));
  console.log("Critérios: Seção 4 do Perfil de Licitações da Eletrium.");
  console.log("PROVISÓRIO: faixa de valor (a própria Seção 4 diz) e a banda R$ 500 mil–1 mi,");
  console.log("            que a Seção 4 não define — tratada como NEUTRA (não corta).");
  console.log("HUMANO:     Seção 4 D (atestado, ART, patrimônio líquido) não é automatizável.");
  console.log("-".repeat(72));
  console.log(`modo: ${cfg.MODO} | janela: ${cfg.JANELA_DIAS} dias | página: ${TAMANHO_PAGINA} reg.`);
  console.log(`palavras-chave (${cfg.PALAVRAS_CHAVE.length}): ${cfg.PALAVRAS_CHAVE.join(", ")}`);
  console.log(`regras de exclusão (${cfg.REGRAS_EXCLUSAO.length}): ${cfg.REGRAS_EXCLUSAO.map((r) => r.id).join(", ")}`);
  console.log(`valor: classifica, NÃO corta — faixa R$ ${cfg.VALOR_FAIXA_MIN} a ${cfg.VALOR_FAIXA_MAX}; > R$ ${cfg.VALOR_CONSORCIO} = avaliar consórcio`);
  console.log(`UF: classifica, NÃO corta — prioritária(s): ${cfg.UFS_PRIORITARIAS.join(", ") || "nenhuma"}`);
  console.log(`subestação: exclui só acima de ${cfg.TENSAO_KV_LIMITE} kV ou termo de alta tensão; sem tensão informada = ${cfg.SUBESTACAO_SEM_TENSAO_INFORMADA}`);
  console.log(`escopo da consulta: ${cfg.UFS_CONSULTA.length ? cfg.UFS_CONSULTA.join(", ") + " (cobertura reduzida por --uf)" : "Brasil inteiro"}`);
  if (cfg.MAX_PAGINAS) console.log(`LIMITE: no máximo ${cfg.MAX_PAGINAS} páginas por consulta (varredura parcial)`);
  console.log("-".repeat(72));

  const stats = {
    totalRegistrosApi: 0,
    registrosRecebidos: 0,
    duplicadosDescartados: 0,
    registrosUnicos: 0,
    reprovadosPalavraChave: 0,
    passaramPalavraChave: 0,
    reprovadosExclusao: 0,
    porRegraExclusao: {},
    passaramExclusao: 0,
    classificacaoUf: {},   // não corta — só conta (Seção 4 C)
    faixaValor: {},        // não corta — só conta (Seção 4 B)
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
  const ufs = cfg.UFS_CONSULTA.length ? cfg.UFS_CONSULTA : [null];

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

  const { aprovados, descartados } = filtrar(unicos, cfg, stats);
  stats.relevantes = aprovados.length;

  const res = salvar(aprovados, descartados, cfg, stats, dirSaida);

  const linhaConta = (obj) =>
    Object.keys(obj).length === 0
      ? "—"
      : Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(" | ");

  console.log("-".repeat(72));
  console.log("FUNIL DE FILTRAGEM");
  console.log(`  registros informados pela API .......... ${stats.totalRegistrosApi}`);
  console.log(`  páginas lidas ......................... ${stats.paginasLidas}${stats.varreduraTruncada ? "  (VARREDURA PARCIAL — --max-paginas)" : ""}`);
  console.log(`  registros recebidos ................... ${stats.registrosRecebidos}`);
  console.log(`  duplicados descartados ................ ${stats.duplicadosDescartados}`);
  console.log(`  registros únicos analisados ........... ${stats.registrosUnicos}`);
  console.log(`  - reprovados por palavra-chave ........ ${stats.reprovadosPalavraChave}`);
  console.log(`  = passaram por palavra-chave .......... ${stats.passaramPalavraChave}`);
  console.log(`  - reprovados por termo de EXCLUSÃO .... ${stats.reprovadosExclusao}`);
  for (const [regra, n] of Object.entries(stats.porRegraExclusao)) {
    console.log(`      · ${regra} ${".".repeat(Math.max(1, 28 - regra.length))} ${n}`);
  }
  console.log(`  = passaram por exclusão ............... ${stats.passaramExclusao}`);
  console.log(`  - reprovados por score mínimo ......... ${stats.reprovadosScore}`);
  console.log(`  >> RELEVANTES ......................... ${stats.relevantes}`);
  console.log("");
  console.log("CLASSIFICAÇÃO (não corta — Seção 4 B e C)");
  console.log(`  porte/valor ... ${linhaConta(stats.faixaValor)}`);
  console.log(`  geografia ..... ${linhaConta(stats.classificacaoUf)}`);
  if (descartados.length) {
    console.log("");
    console.log("DESCARTADOS COM MOTIVO (só quem casou palavra-chave e caiu depois)");
    for (const d of descartados) {
      console.log(`  [${d.regraDescarte}] ${d.numeroControlePNCP} — ${d.uf || "??"}`);
      console.log(`     motivo: ${d.motivoDescarte}`);
      if (d.termosDescarte && d.termosDescarte.length) {
        console.log(`     termos: ${d.termosDescarte.join(", ")}`);
      }
      console.log(`     objeto: ${String(d.objeto || "").replace(/\s+/g, " ").slice(0, 150)}`);
    }
  }
  if (res.removidos.length) {
    console.log("");
    console.log("SAÍRAM DO RADAR (estavam no store e agora batem em exclusão)");
    for (const r of res.removidos) {
      console.log(`  [${r.regraDescarte}] ${r.numeroControlePNCP} — ${r.motivoDescarte}`);
    }
  }
  console.log("-".repeat(72));
  console.log(`store: ${res.total} editais (${res.novos} novos, ${res.atualizados} atualizados, ${res.removidos.length} removidos)`);
  console.log(`  JSON: ${res.arqJson}`);
  console.log(`  HTML: ${res.arqHtml}`);

  if (stats.relevantes === 0) {
    console.log("\nNenhum edital relevante nesta janela — isso é um resultado válido.");
    console.log("Confira a lista de descartados acima antes de concluir que o filtro está certo.");
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

module.exports = {
  CONFIG, normalizar, squash, casaPalavraChave, casaTermoExclusao, termosPresentes,
  tensoesEmKv, classificarValor, classificarUf, avaliar, filtrar, linkPncp,
  FAIXA, GEO, AVALIACAO_HUMANA,
};
