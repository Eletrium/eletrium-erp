// graph.js — auth delegada (MSAL) + helpers do Microsoft Graph, compartilhado entre as telas.
// Requer msal-browser (CDN) carregado antes. Config em AUTH-DELEGADO.md do repo ERPEletrium.
window.EG = (function () {
  const CONFIG = {
    clientId: "f0c63078-fe75-4f7a-8f87-8783c12e7df8", // Eletrium ERP - Web App (delegado, SPA)
    tenantId: "6b76ebcc-abef-462d-a0be-eebf5a9e434b",
    siteHost: "gwtecheletrica.sharepoint.com",
    sitePath: "/sites/EletriumERP",
    scopes: ["User.Read", "Sites.ReadWrite.All"]
  };
  const GRAPH = "https://graph.microsoft.com/v1.0";
  let msalApp = null, account = null, siteId = null, currentUser = null;

  async function init() {
    msalApp = new msal.PublicClientApplication({
      auth: { clientId: CONFIG.clientId, authority: "https://login.microsoftonline.com/" + CONFIG.tenantId, redirectUri: window.location.origin },
      cache: { cacheLocation: "sessionStorage" }
    });
    await msalApp.initialize();
    const a = msalApp.getAllAccounts();
    if (a.length) { account = a[0]; msalApp.setActiveAccount(account); }
    return !!account;
  }
  async function login() { const r = await msalApp.loginPopup({ scopes: CONFIG.scopes }); account = r.account; msalApp.setActiveAccount(account); return account; }
  async function logout() { await msalApp.logoutPopup({ account }); account = null; currentUser = null; }
  const getAccount = () => account;

  // `forcarRenovacao` (opcional) ignora o cache do MSAL — usado pelo apiRequest
  // quando o Graph devolve 401 com token que o MSAL ainda achava válido.
  // Chamadas existentes sem argumento continuam idênticas.
  async function token(forcarRenovacao) {
    const req = { scopes: CONFIG.scopes, account, forceRefresh: !!forcarRenovacao };
    try { return (await msalApp.acquireTokenSilent(req)).accessToken; }
    catch { return (await msalApp.acquireTokenPopup(req)).accessToken; }
  }

  // ---------------------------------------------------------------------------
  // apiRequest — ponto ÚNICO de rede com o Graph. gget/gpatch/gpost são cascas
  // finas sobre ele (assinaturas públicas inalteradas). Concentrar aqui permite:
  //   1. erro normalizado (status + código do Graph + mensagem pt-BR) em vez do
  //      text() cru que as telas mostravam ao usuário;
  //   2. retry automático em 429/503 respeitando Retry-After — throttling do
  //      Graph não pode virar erro na tela;
  //   3. 401 → uma renovação de token forçada antes de desistir (token expirado
  //      no meio de uma sessão longa não derruba a gravação).
  // ---------------------------------------------------------------------------
  const espera = (ms) => new Promise((res) => setTimeout(res, ms));

  // Retry-After pode vir em segundos ou como data HTTP; sem header, backoff
  // simples proporcional à tentativa. Teto de 10s: melhor falhar rápido do que
  // deixar o usuário olhando uma tela congelada.
  function esperaDoRetryAfter(r, tentativa) {
    const TETO_MS = 10000;
    const bruto = r.headers && r.headers.get ? r.headers.get("Retry-After") : null;
    let ms = NaN;
    if (bruto != null && bruto !== "") {
      const seg = Number(bruto);
      if (!isNaN(seg)) ms = seg * 1000;
      else { const quando = Date.parse(bruto); if (!isNaN(quando)) ms = quando - Date.now(); }
    }
    if (isNaN(ms) || ms < 0) ms = 1000 * tentativa;
    return Math.min(ms, TETO_MS);
  }

  // Monta um Error legível a partir da resposta de erro do Graph.
  // O corpo de erro do Graph é JSON {"error":{"code","message"}} — parseamos
  // quando der; se não der (proxy, HTML de gateway), o texto cru vai em e.corpo.
  async function erroGraph(r) {
    let corpo = "", codigo = "", msgServidor = "";
    try { corpo = await r.text(); } catch { /* resposta sem corpo */ }
    try {
      const j = JSON.parse(corpo);
      if (j && j.error) { codigo = j.error.code || ""; msgServidor = j.error.message || ""; }
    } catch { /* corpo não é JSON — segue com o texto cru */ }
    const DESC = {
      400: "requisição inválida",
      401: "sessão expirada — entre novamente",
      403: "sem permissão para esta operação",
      404: "recurso não encontrado no SharePoint",
      409: "conflito de edição (alguém alterou antes)",
      412: "pré-condição falhou",
      429: "limite de requisições do Graph atingido",
      500: "erro interno do Graph",
      502: "falha no gateway do Graph",
      503: "serviço do Graph indisponível no momento",
      504: "o Graph demorou demais para responder"
    };
    const desc = DESC[r.status] || "erro HTTP " + r.status;
    const e = new Error("Graph " + r.status + (codigo ? " (" + codigo + ")" : "") + " — " + desc + (msgServidor ? ": " + msgServidor : ""));
    e.status = r.status;
    e.codigo = codigo;
    e.corpo = corpo;
    return e;
  }

  async function apiRequest(method, url, body, extraHeaders) {
    const full = url.startsWith("http") ? url : GRAPH + url;
    let t = await token();
    let tentativasThrottle = 0, renovou401 = false;
    for (;;) {
      const headers = { Authorization: "Bearer " + t, Accept: "application/json" };
      if (extraHeaders) for (const k of Object.keys(extraHeaders)) headers[k] = extraHeaders[k];
      const opcoes = { method, headers };
      if (body !== undefined) { headers["Content-Type"] = "application/json"; opcoes.body = JSON.stringify(body); }
      const r = await fetch(full, opcoes);
      if (r.ok) {
        // 204/corpo vazio (DELETE, alguns PATCH) não pode explodir no .json()
        if (r.status === 204) return null;
        const texto = await r.text();
        return texto ? JSON.parse(texto) : null;
      }
      if ((r.status === 429 || r.status === 503) && tentativasThrottle < 2) {
        tentativasThrottle++;
        await espera(esperaDoRetryAfter(r, tentativasThrottle));
        continue;
      }
      if (r.status === 401 && !renovou401) {
        renovou401 = true;
        t = await token(true); // uma chance de renovar o token antes de falhar
        continue;
      }
      throw await erroGraph(r);
    }
  }

  /** GET no Graph (url relativa ao v1.0 ou absoluta). Retorna o JSON da resposta. */
  const gget = (url) => apiRequest("GET", url);
  /** PATCH no Graph com corpo JSON. Retorna o JSON da resposta (ou null se vazia). */
  const gpatch = (url, body, extraHeaders) => apiRequest("PATCH", url, body, extraHeaders);
  /** POST no Graph com corpo JSON. Retorna o JSON da resposta (ou null se vazia). */
  const gpost = (url, body) => apiRequest("POST", url, body);

  async function me() {
    if (currentUser) return currentUser;
    const m = await gget("/me?$select=id,displayName,userPrincipalName,mail");
    currentUser = { id: m.id, nome: m.displayName, email: m.mail || m.userPrincipalName };
    return currentUser;
  }
  async function resolveSite() {
    if (siteId) return siteId;
    const s = await gget("/sites/" + CONFIG.siteHost + ":" + CONFIG.sitePath);
    if (!s.id) throw new Error("não resolveu o site");
    siteId = s.id; return siteId;
  }

  // Lista itens SEGUINDO @odata.nextLink até o fim — o Graph pagina em 200 por
  // padrão (500 com $top=500) e antes disso as telas truncavam EM SILÊNCIO ao
  // passar desse volume. Assinatura e retorno (array de itens) inalterados.
  // Teto de segurança: 20 páginas / 10.000 itens — acima disso é sinal de query
  // errada (sem filtro) e o loop avisaria no console em vez de travar a aba.
  async function listItems(list, query) {
    const sid = await resolveSite();
    const q = query || "expand=fields&$top=500";
    let url = "/sites/" + sid + "/lists/" + encodeURIComponent(list) + "/items?" + q;
    const MAX_PAGINAS = 20, MAX_ITENS = 10000;
    const itens = [];
    let paginas = 0;
    while (url) {
      const pagina = await gget(url);
      const lote = pagina.value || [];
      for (let i = 0; i < lote.length; i++) itens.push(lote[i]);
      paginas++;
      url = pagina["@odata.nextLink"] || null;
      if (url && (paginas >= MAX_PAGINAS || itens.length >= MAX_ITENS)) {
        console.warn("EG.listItems('" + list + "'): teto de paginação atingido (" + paginas + " página(s), " + itens.length + " itens) — resultado TRUNCADO. Revise a query ($filter/$top).");
        break;
      }
    }
    return itens;
  }
  async function listColumns(list) {
    const sid = await resolveSite();
    return (await gget("/sites/" + sid + "/lists/" + encodeURIComponent(list) + "/columns")).value || [];
  }
  // B3 (Roadmap OS v2.1): toda atualização é CONDICIONAL por ETag (If-Match).
  // Lê o etag atual do item e envia o PATCH condicionado: se alguém gravou no
  // meio, o Graph devolve 412 e NÓS NÃO SOBRESCREVEMOS — o erro instrui a
  // reler. As telas já releem do servidor após gravar; em conflito, o catch
  // existente mostra a mensagem e o usuário recarrega o item antes de reaplicar.
  async function patchItemFields(list, id, fields) {
    checarTravas(list, fields); // fail-closed: bloqueia ANTES de ir à rede (só com trava registrada)
    const sid = await resolveSite();
    const base = "/sites/" + sid + "/lists/" + encodeURIComponent(list) + "/items/" + id;
    let etag = null;
    try {
      const item = await gget(base + "?$select=id");
      etag = item && item["@odata.etag"] ? item["@odata.etag"] : null;
    } catch { /* sem etag (item inacessível?) — o PATCH abaixo falhará com o erro real */ }
    try {
      return await gpatch(base + "/fields", fields, etag ? { "If-Match": etag } : undefined);
    } catch (e) {
      if (e && e.status === 412) {
        e.message = "conflito de edição: o item foi alterado por outra pessoa/processo depois que você o carregou — recarregue e reaplique a mudança (nada foi sobrescrito)";
        e.conflitoEdicao = true;
      }
      throw e;
    }
  }
  // Cria item. `fields` usa nomes INTERNOS; lookup vai como <Campo>LookupId
  // (ex.: ClienteLookupId: 3) — o Graph não aceita "Cliente" com objeto.
  // Só inclua chaves com valor: campo vazio enviado como "" grava vazio.
  async function createItem(list, fields) {
    checarTravas(list, fields); // fail-closed: bloqueia ANTES de ir à rede (só com trava registrada)
    const sid = await resolveSite();
    return gpost("/sites/" + sid + "/lists/" + encodeURIComponent(list) + "/items", { fields });
  }

  // helpers de formatação
  const BRL = (n) => (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  // Campo *Date only* do SharePoint volta do Graph como "AAAA-MM-DDT00:00:00Z".
  // new Date() interpreta meia-noite UTC; em Brasília (UTC-3) isso é 21:00 do dia
  // ANTERIOR — a tela exibiria/filtraria 1 dia a menos. Meia-noite UTC exata é
  // tratada como data-pura e formatada em UTC (timestamps reais quase nunca caem
  // exatamente em 00:00:00Z; para eles o comportamento local continua).
  const ehDataPura = (s) => /T00:00(:00(\.0+)?)?(Z|\+00:00)$/.test(String(s));
  const fmtDate = (s) => {
    if (!s) return null;
    const d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleDateString("pt-BR", ehDataPura(s) ? { timeZone: "UTC" } : undefined);
  };

  // ---------------------------------------------------------------------------
  // Validação de rótulos de Choice hard-coded (guarda contra falha SILENCIOSA).
  //
  // Telas hard-codeiam rótulos com acento/travessão ("Manutenção corretiva",
  // "Execução de projeto — programada", "Atribuída"...). Se o rótulo real do
  // SharePoint divergir por um caractere, nada quebra: o item cai no fallback
  // (cinza / "Outros") e o NÚMERO FICA ERRADO EM SILÊNCIO. Foi essa classe de
  // bug que travou o Kanban do canvas (colEtapasPipeline sem acento).
  // Mesma ideia de validateEtapasConfig() do pipeline.js, agora genérica.
  //
  // Uso:  const v = await EG.validarChoices("OrdensDeServico", "Status", Object.keys(STATUS_COR));
  //       EG.renderAvisoChoices(document.getElementById("choiceWarn"), v, "Status de OS");
  // ---------------------------------------------------------------------------
  // opts.apenasSemChoice = true  -> ignora a direção "existe no SP mas não no código".
  //   Use quando o fallback é INTENCIONAL (ex.: dashboard agrupa o resto em "Outros"),
  //   senão o aviso vira ruído. A direção "no código mas não existe no SP" continua ativa.
  async function validarChoices(lista, campoInterno, chavesLocais, opts) {
    try {
      const cols = await listColumns(lista);
      const col = (cols || []).find(c => c.name === campoInterno);
      if (!col || !col.choice || !Array.isArray(col.choice.choices)) {
        return { ok: true, indisponivel: true, motivo: "coluna '" + campoInterno + "' não é Choice ou não foi encontrada em " + lista, choices: [], semConfig: [], semChoice: [] };
      }
      const choices = col.choice.choices;
      const locais = chavesLocais || [];
      // no SharePoint mas sem entrada local -> cai no fallback (cor/bucket errado)
      const semConfig = (opts && opts.apenasSemChoice) ? [] : choices.filter(c => !locais.includes(c));
      // no código mas inexistente no SharePoint -> filtro/bucket nunca casa
      const semChoice = locais.filter(k => !choices.includes(k));
      return { ok: semConfig.length === 0 && semChoice.length === 0, indisponivel: false, choices, semConfig, semChoice };
    } catch (e) {
      return { ok: true, indisponivel: true, motivo: "falha ao ler choices de " + lista + "." + campoInterno + ": " + e.message, choices: [], semConfig: [], semChoice: [] };
    }
  }

  // ---------------------------------------------------------------------------
  // Travas fail-closed de Choice (OPT-IN por tela — retrocompatível).
  //
  // validarChoices só AVISA; a gravação com rótulo errado passava e virava dado
  // órfão no SharePoint. travarChoices valida igual, MAS registra o resultado:
  // a partir daí, patchItemFields/createItem BLOQUEIAM client-side qualquer
  // payload cujo campo travado carregue valor que não existe nos choices reais
  // do servidor — antes do PATCH/POST. Sem trava registrada, nada muda (as 15
  // telas atuais continuam funcionando sem alteração).
  // ---------------------------------------------------------------------------
  const travas = {}; // "lista||campo" -> { choices, semChoice, semConfig, registradoEm }
  const chaveTrava = (lista, campo) => lista + "||" + campo;

  /**
   * Valida choices como EG.validarChoices e REGISTRA o resultado como trava
   * fail-closed para (lista, campoInterno). Retorna o mesmo objeto de validação
   * (pode ir direto para renderAvisoChoices/renderAvisosChoices).
   * @param {string} lista nome da lista do SharePoint
   * @param {string} campoInterno nome interno da coluna Choice
   * @param {string[]} chavesLocais rótulos hard-coded da tela
   * @param {{apenasSemChoice?: boolean}} [opts] mesmo contrato de validarChoices
   */
  async function travarChoices(lista, campoInterno, chavesLocais, opts) {
    const v = await validarChoices(lista, campoInterno, chavesLocais, opts);
    // indisponível (coluna não é Choice / Graph falhou) não vira trava:
    // fail-closed só faz sentido com os choices REAIS do servidor em mãos.
    if (!v.indisponivel) {
      travas[chaveTrava(lista, campoInterno)] = {
        choices: v.choices.slice(),
        semChoice: v.semChoice.slice(),
        semConfig: v.semConfig.slice(),
        registradoEm: new Date().toISOString()
      };
    }
    return v;
  }

  // Checagem executada por patchItemFields/createItem. Só age quando a trava
  // registrada tem DIVERGÊNCIA (semChoice não vazio) — cenário em que a tela
  // comprovadamente carrega rótulo que não existe no servidor. Trava sem
  // divergência não bloqueia nada: comportamento atual intacto.
  function checarTravas(lista, fields) {
    if (!fields) return;
    for (const campo of Object.keys(fields)) {
      const t = travas[chaveTrava(lista, campo)];
      if (!t || !t.semChoice.length) continue;
      const valores = Array.isArray(fields[campo]) ? fields[campo] : [fields[campo]];
      for (const v of valores) {
        if (v == null || v === "" || typeof v !== "string") continue;
        if (!t.choices.includes(v)) {
          const e = new Error("valor '" + v + "' não existe no Choice '" + campo + "' do SharePoint — gravação bloqueada (fail-closed)");
          e.failClosed = true; e.lista = lista; e.campo = campo; e.valor = v;
          throw e;
        }
      }
    }
  }

  /**
   * Snapshot (cópia) das travas fail-closed registradas — para debug no console.
   * @returns {Object.<string, {choices: string[], semChoice: string[], semConfig: string[], registradoEm: string}>}
   */
  function travasAtivas() { return JSON.parse(JSON.stringify(travas)); }

  // Renderiza (ou esconde) o aviso num elemento. `rotulo` identifica o campo p/ o usuário.
  function renderAvisoChoices(el, v, rotulo) {
    if (!el) return;
    const esc = (s) => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    if (!v || v.ok) { el.hidden = true; el.innerHTML = ""; return; }
    const cod = (arr) => arr.map(x => "<code>" + esc(x) + "</code>").join(" ");
    let html = "<strong>⚠️ Divergência de rótulos — " + esc(rotulo) + ":</strong><br>";
    if (v.semChoice.length) html += "No código mas <em>não existe</em> no SharePoint (filtro/agrupamento nunca casa): " + cod(v.semChoice) + "<br>";
    if (v.semConfig.length) html += "No SharePoint mas <em>sem</em> tratamento no código (cai no padrão, número pode ficar errado): " + cod(v.semConfig);
    el.innerHTML = html; el.hidden = false;
  }

  // Versão plural: recebe [{v, rotulo}, ...] e junta tudo num aviso só.
  function renderAvisosChoices(el, pares) {
    if (!el) return;
    const ruins = (pares || []).filter(p => p && p.v && !p.v.ok);
    if (!ruins.length) { el.hidden = true; el.innerHTML = ""; return; }
    const esc = (s) => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const cod = (arr) => arr.map(x => "<code>" + esc(x) + "</code>").join(" ");
    let html = "<strong>⚠️ Divergência de rótulos de Choice</strong> (números podem ficar errados em silêncio):";
    ruins.forEach(p => {
      html += "<br><em>" + esc(p.rotulo) + "</em> — ";
      const partes = [];
      if (p.v.semChoice.length) partes.push("no código mas não existe no SharePoint: " + cod(p.v.semChoice));
      if (p.v.semConfig.length) partes.push("no SharePoint mas sem tratamento: " + cod(p.v.semConfig));
      html += partes.join(" · ");
    });
    el.innerHTML = html; el.hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Estados de tela — utilitário para a onda 2 (nenhuma tela precisa usar ainda).
  // Hoje cada tela improvisa "Carregando..." num setStatus próprio e confunde
  // "vazio de verdade" com "nem carregou". Este helper padroniza os 4 estados.
  // ---------------------------------------------------------------------------
  /**
   * Renderiza um dos 4 estados padrão de tela no elemento dado.
   * @param {HTMLElement} el contêiner do estado (ex.: uma div acima da tabela)
   * @param {"carregando"|"vazio"|"erro"|"ok"} estado "ok" esconde o elemento
   * @param {{mensagem?: string, onRetry?: function}} [opts] mensagem custom;
   *        onRetry (só no "erro") liga o botão "Tentar de novo"
   */
  function renderEstado(el, estado, opts) {
    if (!el) return;
    const o = opts || {};
    const esc = (s) => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    if (estado === "ok") { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    if (estado === "carregando") {
      // spinner textual: sem dependência de CSS novo, as telas atuais não têm keyframes
      el.innerHTML = '<span class="eg-estado eg-estado-carregando">⏳ ' + esc(o.mensagem || "Carregando…") + "</span>";
      return;
    }
    if (estado === "vazio") {
      // vazio REAL: dados carregados e não há itens — diferente de "ainda carregando"
      el.innerHTML = '<span class="eg-estado eg-estado-vazio">' + esc(o.mensagem || "Nenhum item encontrado.") + "</span>";
      return;
    }
    if (estado === "erro") {
      el.innerHTML = '<span class="eg-estado eg-estado-erro">' + esc(o.mensagem || "Não foi possível carregar os dados.") + "</span>" +
        (typeof o.onRetry === "function" ? ' <button type="button" class="eg-estado-retry">Tentar de novo</button>' : "");
      const btn = el.querySelector(".eg-estado-retry");
      if (btn) btn.addEventListener("click", o.onRetry);
      return;
    }
    console.warn("EG.renderEstado: estado desconhecido '" + estado + "' (esperado: carregando | vazio | erro | ok)");
  }

  // ---------------------------------------------------------------------------
  // POLÍTICAS OPERACIONAIS VERSIONADAS — parâmetro de negócio fora do código.
  //
  // MESMO PADRÃO DO B5 (Tarifas_Versoes + tarifaVigente() em medicao.html): o
  // valor mora numa lista COM VIGÊNCIA, a versão que vale é resolvida por data,
  // e a ausência de versão é tratada explicitamente. Deliberadamente NÃO é um
  // segundo padrão para o mesmo problema — herda os mesmos nomes de campo
  // (Vigencia_Inicio / Vigencia_Fim DateOnly, Ativa Boolean, Notas Note) e a
  // mesma regra de desempate. Só muda a granularidade da chave de tempo:
  // tarifa resolve por COMPETÊNCIA (AAAA-MM, é o que o negócio fatura),
  // política resolve por DIA (AAAA-MM-DD), porque a pergunta aqui é "quanto
  // vale HOJE", não "quanto valia no mês de referência".
  //
  // *** LIMITAÇÃO DECLARADA — imposição é CLIENT-SIDE ***
  // A imposição server-side destes limites dependeria do gateway B1, que NÃO
  // EXISTE. Hoje a política é lida e aplicada SOMENTE NO CLIENTE: quem escrever
  // direto no Graph contorna o limite. Mudar um valor aqui muda o que as TELAS
  // fazem, não o que o SharePoint aceita. Mesmo padrão de limitação declarada
  // já usado no repo (ver cabeçalho de outbox.js sobre o transmissor B1).
  //
  // FAIL-SAFE: se a lista não carregar (offline / sem login / sem permissão) ou
  // não houver versão vigente, vale o DEFAULT abaixo — que é EXATAMENTE o valor
  // que estava hardcoded antes desta migração. A tela nunca quebra e nunca
  // aplica valor arbitrário; o desvio é avisado no console.
  // ---------------------------------------------------------------------------
  const POLITICAS_LISTA = "Politicas_Operacionais_Versoes";

  // Valores em vigor ANTES da migração — NÃO somem do código, são o piso de
  // segurança de quem está sem acesso à lista. Para MUDAR um valor de verdade,
  // crie uma versão nova na lista (nova Vigencia_Inicio); mexer aqui só muda o
  // comportamento do fallback.
  const POLITICAS_DEFAULT = {
    OUTBOX_DESCARTE_DIAS:   { valor: 7,  unidade: "dias"     }, // outbox.js — descarte de item terminal da fila
    OFERTA_EXPIRACAO_HORAS: { valor: 24, unidade: "horas"    }, // portal-alocacao.html — prazo padrão da oferta
    KM_DESVIO_PCT:          { valor: 20, unidade: "porcento" }  // os.html — limiar de desvio de KM (regra DESLIGADA, C5)
  };

  // Chave AAAA-MM-DD. Campo DateOnly chega do Graph como "2026-08-04T00:00:00Z":
  // fatiar os 10 primeiros caracteres preserva a data CALENDÁRIA gravada e evita
  // o deslocamento de 1 dia que um new Date() em Brasília (UTC-3) causaria — é o
  // mesmo cuidado que parseD()/ehDataPura() tomam em medicao.html. Um Date real
  // (ex.: "agora") vira a data LOCAL, que é o "hoje" que o usuário enxerga.
  function dKeyPolitica(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return null;
      return v.getFullYear() + "-" + String(v.getMonth() + 1).padStart(2, "0") + "-" + String(v.getDate()).padStart(2, "0");
    }
    const s = String(v);
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /**
   * Versão VIGENTE de uma política num instante. PURA — não faz rede.
   * Regra idêntica à de tarifaVigente() (B5):
   *   Ativa === true; Vigencia_Inicio <= dia; sem Vigencia_Fim = vigência aberta,
   *   com Vigencia_Fim exige dia <= fim; sem Vigencia_Inicio NÃO vigora;
   *   sobreposição desempata pela Vigencia_Inicio MAIS RECENTE.
   * @param {Array|null} itens itens crus da lista (fields expandidos); null = não carregou
   * @param {string} chave ex.: "OUTBOX_DESCARTE_DIAS"
   * @param {Date|string} [quando] default: agora
   * @returns {object|null} o item vigente, ou null
   */
  function politicaVigenteEm(itens, chave, quando) {
    const dia = dKeyPolitica(quando || new Date());
    if (!Array.isArray(itens) || !dia) return null;
    const cand = itens.filter((it) => {
      const f = (it && it.fields) || {};
      if (String(f.Chave_Politica || "") !== String(chave)) return false;
      if (f.Ativa !== true) return false;
      const ini = dKeyPolitica(f.Vigencia_Inicio);
      if (!ini || ini > dia) return false;          // sem início não há vigência definida; início futuro ainda não vale
      const fim = dKeyPolitica(f.Vigencia_Fim);
      if (fim && fim < dia) return false;           // vigência encerrada
      return true;
    });
    if (!cand.length) return null;
    cand.sort((a, b) => String(dKeyPolitica((b.fields || {}).Vigencia_Inicio) || "")
      .localeCompare(String(dKeyPolitica((a.fields || {}).Vigencia_Inicio) || "")));
    return cand[0];
  }

  /**
   * Valor EFETIVO de uma política, já com o fail-safe aplicado. PURA — não faz
   * rede, é o hook testável da regra. NUNCA lança e NUNCA devolve valor
   * arbitrário: ou vem da lista, ou vem do DEFAULT documentado.
   * @returns {{chave,valor,unidade,fonte:"politica"|"default",versaoId,motivo}|null}
   *          null só para chave desconhecida (erro de programação).
   */
  function resolverPolitica(itens, chave, quando) {
    const def = POLITICAS_DEFAULT[chave];
    if (!def) {
      console.warn("EG.resolverPolitica: chave desconhecida '" + chave + "' — sem DEFAULT declarado em POLITICAS_DEFAULT.");
      return null;
    }
    const cair = (motivo) => ({ chave, valor: def.valor, unidade: def.unidade, fonte: "default", versaoId: null, motivo });
    if (!Array.isArray(itens)) return cair("lista " + POLITICAS_LISTA + " não carregou");
    const item = politicaVigenteEm(itens, chave, quando);
    if (!item) return cair("nenhuma versão vigente de '" + chave + "'");
    const f = item.fields || {};
    // Valor vazio NÃO pode virar 0: Number(null)/Number("") === 0 e isFinite(0)
    // é true — um 0 aqui zeraria a retenção da fila (apagaria tudo na hora) ou o
    // prazo da oferta (expiraria toda proposta na criação). Vazio = inválido.
    const bruto = f.Valor;
    const v = (bruto === null || bruto === undefined || bruto === "") ? NaN : Number(bruto);
    // Todas as políticas declaradas em POLITICAS_DEFAULT são GRANDEZAS
    // ESTRITAMENTE POSITIVAS (dias, horas, porcento). Zero/negativo é dado
    // ruim, não configuração — cai no default em vez de virar comportamento
    // destrutivo. Se algum dia existir política que aceite 0, esta guarda
    // precisa descer para o consumidor, não sumir daqui.
    if (!isFinite(v) || v <= 0) {
      return cair("versão #" + item.id + " de '" + chave + "' tem Valor inválido (" + JSON.stringify(bruto) + ")");
    }
    return { chave, valor: v, unidade: f.Unidade || def.unidade, fonte: "politica", versaoId: item.id, motivo: null };
  }

  // Cache por aba: a lista é minúscula e as telas perguntam várias vezes. Falha
  // NÃO fica grudada no cache — a próxima chamada tenta de novo.
  let politicasPromessa = null;
  function carregarPoliticas(forcar) {
    if (forcar) politicasPromessa = null;
    if (!politicasPromessa) {
      politicasPromessa = listItems(POLITICAS_LISTA).catch((e) => {
        console.warn("EG.carregarPoliticas: " + POLITICAS_LISTA + " não carregou (" + ((e && e.message) || e) +
                     ") — as telas seguem nos DEFAULTS do código.");
        politicasPromessa = null;
        return null;
      });
    }
    return politicasPromessa;
  }

  /** Valor efetivo da política (assíncrono, com cache). Nunca lança. */
  async function politica(chave, quando) {
    const r = resolverPolitica(await carregarPoliticas(), chave, quando);
    if (r && r.fonte === "default" && r.motivo) {
      console.warn("EG.politica('" + chave + "'): " + r.motivo + " — usando DEFAULT " + r.valor + " " + r.unidade +
                   " (mesmo valor de antes da migração; comportamento preservado).");
    }
    return r;
  }

  return { CONFIG, GRAPH, init, login, logout, getAccount, token, gget, gpatch, gpost, me, resolveSite, listItems, listColumns, patchItemFields, createItem, BRL, fmtDate, ehDataPura, validarChoices, renderAvisoChoices, renderAvisosChoices, travarChoices, travasAtivas, renderEstado,
           POLITICAS_LISTA, POLITICAS_DEFAULT, dKeyPolitica, politicaVigenteEm, resolverPolitica, carregarPoliticas, politica };
})();
