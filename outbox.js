// outbox.js — B2 (Roadmap OS v2.1): fila offline (outbox) + idempotência client-side.
// Sem framework, compartilhado entre telas. Requer graph.js (EG.*) carregado antes.
//
// PAPEL NO ROADMAP: o gateway server-side (B1) aguarda aval do dono. Enquanto
// ele não existe, o TRANSMISSOR desta fila fala DIRETO com o Graph via EG.*
// (createItem/patchItemFields). Quando o B1 entrar, troca-se SÓ transmitirUma()
// (EG.* -> chamada ao gateway); fila, estados, reconciliação e widget ficam.
//
// IDEMPOTÊNCIA EM DUAS CAMADAS:
//   - local: enfileirar() recusa operationId duplicado na fila (store.add com
//     chave única do IndexedDB — nem corrida de dois cliques insere duas vezes);
//   - servidor: createItem leva Operation_ID nos fields e a coluna é Text ÚNICO
//     no SharePoint — a rede de segurança REAL é a unicidade server-side. Erro
//     no create de quem tem Operation_ID dispara re-cheque por $filter: item lá
//     = a operação JÁ EXISTIU = CONFIRMADO (não é falha). Mesmo padrão de
//     convergência de romperCadeia()/criarRetificacao() em os.html.
//
// ESTADOS DA OPERAÇÃO:  local -> enviando -> confirmado
//                                        \-> falha (volta pra fila: retry
//                                             automático com backoff quando
//                                             transitória; SÓ manual quando
//                                             permanente ou backoff esgotado)
//
// MÍDIA: nesta fase NÃO há upload de arquivo — anexos são URLs coladas em
// campos de texto (Laudo_URL, Foto_Rompimento_KM_URL, Assinatura_URL...). O
// "estado de mídia" (local/enviando/confirmado/falha) é representado pelo
// estado do REGISTRO DA OPERAÇÃO que carrega essas URLs; upload de binário é
// fase futura e entrará como novo tipo de operação nesta mesma fila.
window.OB = (function () {
  const DB_NOME = "eletrium-outbox";
  const DB_VERSAO = 1;
  const STORE = "operacoes";
  // Só listas COM a coluna Operation_ID (Text ÚNICO e indexado) entram na
  // reconciliação por $filter — hoje apenas OrdensDeServico (LOGRET-*/RETIF-*).
  const LISTAS_COM_OPERATION_ID = ["OrdensDeServico"];
  // backoff dos erros transitórios: 30s, 2min, 10min; esgotou = só retry manual
  const BACKOFF_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000];
  const ENVIANDO_ORFAO_MS = 2 * 60 * 1000;  // "enviando" parado além disso = envio interrompido (aba fechada no meio)
  const RECONCILIA_CADA_MS = 5 * 60 * 1000; // reconciliação periódica com a página aberta
  const RETENCAO_TERMINAL_MS = 7 * 24 * 60 * 60 * 1000; // confirmada/descartada sai do banco após 7 dias

  let dbPromessa = null;
  let processando = false;
  let timerRetry = null, timerQuando = null;

  /* =========================== IndexedDB =========================== */
  function abrirDB() {
    if (dbPromessa) return dbPromessa;
    dbPromessa = new Promise((res, rej) => {
      const req = indexedDB.open(DB_NOME, DB_VERSAO);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "operationId" });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error || new Error("falha ao abrir IndexedDB " + DB_NOME));
    });
    return dbPromessa;
  }
  // uma transação por chamada; resolve com o resultado do request quando a
  // transação COMPLETA (put/add só valem depois do oncomplete)
  async function comStore(modo, fn) {
    const db = await abrirDB();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, modo);
      let req;
      try { req = fn(t.objectStore(STORE)); } catch (e) { rej(e); return; }
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error || (req && req.error) || new Error("erro na transação do outbox"));
      t.onabort = () => rej(t.error || (req && req.error) || new Error("transação do outbox abortada"));
    });
  }
  const obterTodas = () => comStore("readonly", (st) => st.getAll());
  const obterUma = (id) => comStore("readonly", (st) => st.get(id));
  const gravarOp = (op) => comStore("readwrite", (st) => st.put(op));
  const adicionarOp = (op) => comStore("readwrite", (st) => st.add(op)); // add = recusa chave duplicada
  const removerOp = (id) => comStore("readwrite", (st) => st.delete(id));

  // getAll devolve em ordem de CHAVE (operationId) — a fila processa em ordem
  // de CRIAÇÃO (ISO ordena lexicograficamente)
  const ordenar = (ops) => (ops || []).slice().sort((a, b) => String(a.criadaEm).localeCompare(String(b.criadaEm)));
  const naoConfirmada = (op) => op.estado === "local" || op.estado === "enviando" || op.estado === "falha";

  /* ==================== classificação de erros ==================== */
  // erro de REDE do fetch (rejeita com TypeError, sem status HTTP) ou o
  // navegador declaradamente offline — é o que dispara o desvio pra fila
  function ehErroDeRede(e) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
    if (e instanceof TypeError) return true;
    return /failed to fetch|networkerror|load failed|network request failed/i.test(String((e && e.message) || ""));
  }
  // "transitorio" re-tenta com backoff; "permanente" NÃO re-tenta sozinho —
  // pede ação humana (Tentar agora / Descartar no widget).
  // 409/412 ficam FORA do permanente por decisão do roadmap: o retry converge
  // (patchItemFields relê o ETag a cada tentativa; o create é segurado pela
  // unicidade de Operation_ID) em vez de travar a fila.
  function classificarErro(e) {
    if (ehErroDeRede(e)) return "transitorio";
    if (e && e.failClosed) return "permanente"; // trava de Choice do graph.js: payload comprovadamente inválido
    const s = e && e.status;
    if (s === 409 || s === 412 || s === 429) return "transitorio";
    if (s >= 500) return "transitorio";
    if (s >= 400 && s < 500) return "permanente";
    return "transitorio"; // sem status (timeout/aborto): assume transitório
  }

  /* ========================== enfileirar ========================== */
  /**
   * Guarda uma operação na fila. Recusa operationId DUPLICADO na fila
   * (idempotência local): nesse caso NÃO insere de novo e devolve
   * { op: <registro existente>, jaExistia: true }.
   * @param {{operationId: string, tipo: "createItem"|"patchItemFields",
   *          lista: string, itemId?: string|number, fields: Object}} op
   * @returns {Promise<{op: Object, jaExistia: boolean}>}
   */
  async function enfileirar(op) {
    if (!op || !op.operationId) throw new Error("outbox: operationId é obrigatório");
    if (op.tipo !== "createItem" && op.tipo !== "patchItemFields") throw new Error("outbox: tipo deve ser createItem ou patchItemFields");
    if (!op.lista) throw new Error("outbox: lista é obrigatória");
    if (op.tipo === "patchItemFields" && op.itemId == null) throw new Error("outbox: patchItemFields exige itemId");
    if (!op.fields || typeof op.fields !== "object") throw new Error("outbox: fields é obrigatório");
    // cópia profunda: a fila não pode mudar se a tela mexer no objeto depois
    const fields = JSON.parse(JSON.stringify(op.fields));
    // createItem em lista com Operation_ID SEMPRE leva a chave nos fields —
    // é a unicidade do SharePoint que segura duplicata server-side
    if (op.tipo === "createItem" && LISTAS_COM_OPERATION_ID.includes(op.lista)) fields.Operation_ID = op.operationId;
    const reg = {
      operationId: String(op.operationId), // chave única da fila
      tipo: op.tipo,
      lista: op.lista,
      itemId: op.itemId == null ? null : op.itemId,
      fields,
      criadaEm: new Date().toISOString(),
      estado: "local",           // local -> enviando -> confirmado | falha
      tentativas: 0,
      ultimoErro: null,
      confirmadaEm: null,
      permanente: false,         // falha permanente = não re-tenta sozinho
      proximaTentativaEm: null,  // timestamp (ms) do próximo retry automático
      ultimoEnvioEm: null,
      itemIdServidor: null,      // id do item no SharePoint após confirmar
      motivoDescarte: null,
      descartadaEm: null
    };
    try {
      await adicionarOp(reg); // add: o próprio IndexedDB recusa a chave duplicada
    } catch (e) {
      const existente = await obterUma(reg.operationId).catch(() => null);
      if (existente) return { op: existente, jaExistia: true }; // recusado — já está na fila
      throw e;
    }
    renderWidget();
    agendarProcessamento(0); // se estiver online, tenta transmitir já
    return { op: reg, jaExistia: false };
  }

  /* ========================== transmissor ========================== */
  // pré-condições para falar com o servidor: online E autenticado. Sem conta
  // ativa NÃO transmitimos: EG.token() abriria popup de login no meio de um
  // processamento em segundo plano — inaceitável.
  function podeTransmitir() {
    return navigator.onLine !== false && !!(window.EG && EG.getAccount && EG.getAccount());
  }

  // consulta por Operation_ID (coluna Text ÚNICA e INDEXADA — o $filter só é
  // confiável porque é indexado). Mesmo padrão de buscarPorOperationId de os.html.
  async function buscarNoServidor(lista, operationId) {
    const sid = await EG.resolveSite();
    const filtro = encodeURIComponent("fields/Operation_ID eq '" + String(operationId).replace(/'/g, "''") + "'");
    const r = await EG.gget("/sites/" + sid + "/lists/" + encodeURIComponent(lista) + "/items?expand=fields&$filter=" + filtro + "&$top=1");
    return (r && r.value && r.value[0]) || null;
  }

  async function confirmarOp(op, itemIdServidor) {
    op.estado = "confirmado";
    op.confirmadaEm = new Date().toISOString();
    op.ultimoErro = null;
    op.proximaTentativaEm = null;
    if (itemIdServidor != null) op.itemIdServidor = itemIdServidor;
    await gravarOp(op);
  }

  // -------------------------------------------------------------------------
  // TRANSMISSOR de UMA operação — hoje Graph direto via EG.* (o gateway B1
  // aguarda aval do dono). Quando o B1 existir, muda SÓ o miolo do try abaixo.
  // -------------------------------------------------------------------------
  async function transmitirUma(op) {
    op.estado = "enviando";
    op.ultimoEnvioEm = new Date().toISOString();
    await gravarOp(op);
    renderWidget();
    try {
      if (op.tipo === "createItem") {
        const criado = await EG.createItem(op.lista, op.fields);
        await confirmarOp(op, criado && criado.id);
      } else {
        await EG.patchItemFields(op.lista, op.itemId, op.fields);
        await confirmarOp(op, op.itemId);
      }
      return "confirmado";
    } catch (e) {
      // create com Operation_ID que falhou: re-cheque no servidor ANTES de
      // classificar. Erro de UNICIDADE (ou clique anterior/outra aba/sessão
      // que caiu no meio do envio) significa que a operação JÁ EXISTIU —
      // item lá = CONFIRMADO, não é falha.
      if (op.tipo === "createItem" && op.fields && op.fields.Operation_ID && navigator.onLine !== false) {
        const existente = await buscarNoServidor(op.lista, op.fields.Operation_ID).catch(() => null);
        if (existente) { await confirmarOp(op, existente.id); return "confirmado"; }
      }
      const classe = classificarErro(e);
      op.tentativas += 1;
      op.ultimoErro = String((e && e.message) || e);
      op.estado = "falha";               // falha volta pra fila (retry manual/automático)
      op.permanente = classe === "permanente";
      if (!op.permanente && op.tentativas <= BACKOFF_MS.length) {
        const ms = BACKOFF_MS[op.tentativas - 1];
        op.proximaTentativaEm = Date.now() + ms;
        agendarProcessamento(ms);
      } else {
        op.proximaTentativaEm = null;    // permanente ou backoff esgotado: só "Tentar agora"
      }
      await gravarOp(op);
      return classe;
    }
  }

  // processa a fila EM ORDEM de criação. Falha TRANSITÓRIA interrompe o lote
  // (preserva ordem/dependência entre operações — a de trás não fura a fila);
  // falha PERMANENTE não trava a fila: segue para a próxima.
  async function processar() {
    if (processando || !podeTransmitir()) { renderWidget(); return; }
    processando = true;
    try {
      const agora = Date.now();
      const fila = ordenar(await obterTodas()).filter((op) =>
        op.estado === "local" ||
        (op.estado === "falha" && !op.permanente && op.proximaTentativaEm != null && op.proximaTentativaEm <= agora));
      for (const op of fila) {
        if (!podeTransmitir()) break;
        const resultado = await transmitirUma(op);
        if (resultado === "transitorio") break;
      }
    } finally {
      processando = false;
      renderWidget();
    }
  }

  // um timer só de retry: o disparo mais PRÓXIMO vence (não deixa um backoff
  // longo re-agendar por cima de um curto)
  function agendarProcessamento(ms) {
    const quando = Date.now() + Math.max(0, ms || 0);
    if (timerRetry && timerQuando != null && timerQuando <= quando) return;
    if (timerRetry) clearTimeout(timerRetry);
    timerQuando = quando;
    timerRetry = setTimeout(() => {
      timerRetry = null; timerQuando = null;
      processar().catch((e) => console.warn("outbox: processar falhou:", (e && e.message) || e));
    }, Math.max(0, ms || 0));
  }

  /* ========================= reconciliação ========================= */
  // Para operação "enviando" parada há 2+ min (aba fechada/queda no meio do
  // envio — o resultado se perdeu) ou "falha": pergunta ao SERVIDOR se o item
  // com aquele Operation_ID existe. Existe = a operação ACONTECEU = confirmado.
  // Não existe e o envio está órfão = volta como "falha" re-tentável.
  // Só creates em listas com Operation_ID têm essa prova server-side; patch
  // não tem (item existir não prova que o PATCH aplicou) — órfão vira falha.
  // Roda no boot e a cada 5 min com a página aberta.
  async function reconciliar() {
    if (!podeTransmitir()) return;
    const agora = Date.now();
    const ops = ordenar(await obterTodas());
    for (const op of ops) {
      const envioOrfao = op.estado === "enviando" &&
        (agora - Date.parse(op.ultimoEnvioEm || op.criadaEm)) > ENVIANDO_ORFAO_MS;
      if (!envioOrfao && op.estado !== "falha") continue;
      const chave = op.fields && op.fields.Operation_ID;
      const reconciliavel = op.tipo === "createItem" && chave && LISTAS_COM_OPERATION_ID.includes(op.lista);
      if (!reconciliavel) {
        // sem Operation_ID não há como perguntar "isso aconteceu?" ao servidor.
        // Envio órfão volta pra fila como falha; falha comum fica como está.
        if (envioOrfao) {
          op.estado = "falha";
          op.ultimoErro = "envio interrompido (página fechada no meio?) — sem Operation_ID para reconciliar";
          op.proximaTentativaEm = op.permanente ? null : Date.now();
          await gravarOp(op);
        }
        continue;
      }
      let item = null;
      try { item = await buscarNoServidor(op.lista, chave); }
      catch (e) { console.warn("outbox: reconciliação de " + op.operationId + " falhou:", (e && e.message) || e); continue; }
      if (item) {
        await confirmarOp(op, item.id);
      } else if (envioOrfao) {
        op.estado = "falha";
        op.tentativas += 1;
        op.ultimoErro = "envio interrompido e o item NÃO está no servidor — re-enfileirado";
        op.permanente = false;
        op.proximaTentativaEm = Date.now();
        await gravarOp(op);
      }
    }
    renderWidget();
    agendarProcessamento(0);
  }

  /* ==================== ações manuais (widget) ==================== */
  // retry manual: zera o veto (inclusive de falha permanente — o humano
  // mandou tentar) e processa já
  async function tentarAgora(operationId) {
    const op = await obterUma(operationId);
    if (!op || !naoConfirmada(op)) return null;
    op.estado = "local";
    op.permanente = false;
    op.proximaTentativaEm = null;
    await gravarOp(op);
    renderWidget();
    agendarProcessamento(0);
    return op;
  }

  // descarte é DECISÃO HUMANA registrada: motivo obrigatório; o registro fica
  // no banco (estado "descartada") como trilha e sai sozinho após 7 dias
  async function descartar(operationId, motivo) {
    const m = String(motivo == null ? "" : motivo).trim();
    if (!m) throw new Error("outbox: descarte exige motivo");
    const op = await obterUma(operationId);
    if (!op || !naoConfirmada(op)) return null;
    op.estado = "descartada";
    op.motivoDescarte = m;
    op.descartadaEm = new Date().toISOString();
    op.proximaTentativaEm = null;
    await gravarOp(op);
    renderWidget();
    return op;
  }

  /** Snapshot da fila inteira (inclui confirmadas/descartadas ainda retidas). */
  const listar = async () => ordenar(await obterTodas());

  // higiene: confirmada/descartada com mais de 7 dias sai do banco (a fila é
  // operacional, não é arquivo — a trilha permanente é o próprio SharePoint)
  async function limparTerminais() {
    const agora = Date.now();
    for (const op of await obterTodas()) {
      const fim = op.estado === "confirmado" ? op.confirmadaEm : (op.estado === "descartada" ? op.descartadaEm : null);
      if (fim && (agora - Date.parse(fim)) > RETENCAO_TERMINAL_MS) await removerOp(op.operationId);
    }
  }

  /* ========================== UI da fila ========================== */
  // Widget fixo discreto no canto inferior direito. Só aparece quando há
  // operação NÃO confirmada (local/enviando/falha); some quando a fila zera.
  // Clique no resumo expande a lista (estado, tentativas, último erro,
  // Tentar agora / Descartar).
  let widget = null, widgetResumo = null, widgetLista = null, expandido = false;
  const ROTULO_ESTADO = { local: "na fila", enviando: "enviando", confirmado: "confirmado", falha: "falha", descartada: "descartada" };
  const COR_ESTADO = { local: "#58A6FF", enviando: "#D29922", confirmado: "#22B573", falha: "#F85149", descartada: "#8b949e" };
  const escapar = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function montarWidget() {
    if (widget || !document.body) return;
    const css = document.createElement("style");
    css.textContent = [
      "#obWidget{position:fixed;right:14px;bottom:14px;z-index:9999;max-width:340px;font-size:.8rem;",
      "background:#161b22;border:1px solid #30363d;border-radius:10px;color:#e6edf3;",
      "box-shadow:0 6px 24px rgba(0,0,0,.45);font-family:inherit}",
      "#obWidget[hidden]{display:none !important}",
      "#obResumo{padding:8px 12px;cursor:pointer;display:flex;gap:8px;align-items:center;white-space:nowrap}",
      "#obLista{border-top:1px solid #30363d;max-height:300px;overflow:auto;padding:8px 12px;display:flex;flex-direction:column;gap:8px}",
      "#obLista[hidden]{display:none !important}",
      ".ob-op{border:1px solid #30363d;border-radius:8px;padding:6px 8px}",
      ".ob-l1{display:flex;gap:6px;align-items:center;flex-wrap:wrap}",
      ".ob-badge{border:1px solid;border-radius:6px;padding:0 6px;font-size:.72rem;white-space:nowrap}",
      ".ob-sub{color:#8b949e;font-size:.72rem;margin-top:2px}",
      ".ob-err{color:#F85149;font-size:.74rem;margin-top:4px;word-break:break-word}",
      ".ob-btns{display:flex;gap:6px;margin-top:6px}",
      ".ob-btns button{font-size:.74rem;padding:2px 8px;border-radius:6px;border:1px solid #30363d;background:#0d1117;color:#e6edf3;cursor:pointer}",
      ".ob-btns button:hover{border-color:#58A6FF}"
    ].join("");
    document.head.appendChild(css);
    widget = document.createElement("div");
    widget.id = "obWidget";
    widget.hidden = true;
    widget.innerHTML = '<div id="obResumo" title="fila offline (outbox) — clique para detalhar"></div><div id="obLista" hidden></div>';
    document.body.appendChild(widget);
    widgetResumo = widget.querySelector("#obResumo");
    widgetLista = widget.querySelector("#obLista");
    widgetResumo.addEventListener("click", () => { expandido = !expandido; widgetLista.hidden = !expandido; renderWidget(); });
    // delegação: a lista re-renderiza a cada mudança de estado
    widgetLista.addEventListener("click", (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest("button[data-ob-acao]") : null;
      if (!btn) return;
      const id = btn.getAttribute("data-ob-id");
      if (btn.getAttribute("data-ob-acao") === "retry") {
        tentarAgora(id).catch((e) => console.warn("outbox: retry manual falhou:", (e && e.message) || e));
        return;
      }
      // descarte exige confirm + motivo (registrado no banco)
      if (!window.confirm("Descartar esta operação da fila? Ela NÃO será transmitida ao servidor.")) return;
      const motivo = window.prompt("Motivo do descarte (obrigatório — fica registrado):", "");
      if (motivo == null || !motivo.trim()) return;
      descartar(id, motivo).catch((e) => console.warn("outbox: descarte falhou:", (e && e.message) || e));
    });
  }

  // coalesce: várias mudanças seguidas geram UM render (microtask)
  let renderAgendado = false;
  function renderWidget() {
    if (renderAgendado) return;
    renderAgendado = true;
    Promise.resolve().then(async () => {
      renderAgendado = false;
      try { await renderWidgetAgora(); }
      catch (e) { console.warn("outbox: render do widget falhou:", (e && e.message) || e); }
    });
  }
  async function renderWidgetAgora() {
    montarWidget();
    if (!widget) return; // <body> ainda não existe — o boot re-renderiza depois
    const abertas = ordenar(await obterTodas()).filter(naoConfirmada);
    if (!abertas.length) { widget.hidden = true; return; }
    widget.hidden = false;
    const porEstado = {};
    abertas.forEach((op) => { porEstado[op.estado] = (porEstado[op.estado] || 0) + 1; });
    widgetResumo.innerHTML = "📥 Fila: " + ["local", "enviando", "falha"]
      .filter((s) => porEstado[s])
      .map((s) => '<span class="ob-badge" style="border-color:' + COR_ESTADO[s] + ";color:" + COR_ESTADO[s] + '">' + porEstado[s] + " " + ROTULO_ESTADO[s] + "</span>")
      .join(" ") + ' <span style="color:#8b949e">' + (expandido ? "▾" : "▸") + "</span>";
    if (!expandido) return;
    widgetLista.innerHTML = abertas.map((op) => {
      const cor = COR_ESTADO[op.estado] || "#8b949e";
      return '<div class="ob-op">' +
        '<div class="ob-l1"><strong>' + escapar(op.operationId) + "</strong>" +
        '<span class="ob-badge" style="border-color:' + cor + ";color:" + cor + '">' + escapar(ROTULO_ESTADO[op.estado] || op.estado) + "</span></div>" +
        '<div class="ob-sub">' + escapar(op.tipo + " · " + op.lista + (op.itemId != null ? " #" + op.itemId : "")) +
          " · tentativas: " + Number(op.tentativas || 0) +
          (op.permanente ? " · falha permanente (só manual)" : "") +
          (op.proximaTentativaEm ? " · re-tenta " + new Date(op.proximaTentativaEm).toLocaleTimeString("pt-BR") : "") + "</div>" +
        (op.ultimoErro ? '<div class="ob-err">' + escapar(op.ultimoErro) + "</div>" : "") +
        '<div class="ob-btns">' +
          '<button type="button" data-ob-acao="retry" data-ob-id="' + escapar(op.operationId) + '">Tentar agora</button>' +
          '<button type="button" data-ob-acao="descartar" data-ob-id="' + escapar(op.operationId) + '">Descartar</button>' +
        "</div></div>";
    }).join("");
  }

  /* ============================= boot ============================= */
  let iniciado = false;
  async function iniciar() {
    if (iniciado) return;
    iniciado = true;
    if (!("indexedDB" in window)) {
      console.warn("outbox: IndexedDB indisponível neste navegador/modo — fila offline DESATIVADA (os fluxos seguem no caminho direto).");
      return;
    }
    try { await abrirDB(); }
    catch (e) { console.warn("outbox: falha ao abrir o banco (modo privado? cota?):", (e && e.message) || e); return; }
    await limparTerminais().catch(() => {});
    renderWidget();
    // a volta da conexão escoa a fila e reconcilia
    window.addEventListener("online", () => {
      processar().catch(() => {});
      reconciliar().catch(() => {});
    });
    // A tela autentica DEPOIS deste script (EG.init roda no fim do body): o
    // guard de conta ativa em podeTransmitir() pula silenciosamente enquanto
    // não há login. Tentamos já, de novo em +20s (pega a sessão que acabou de
    // autenticar) e a reconciliação segue a cada 5 min com a página aberta.
    processar().catch(() => {});
    reconciliar().catch(() => {});
    setTimeout(() => { processar().catch(() => {}); reconciliar().catch(() => {}); }, 20 * 1000);
    setInterval(() => { reconciliar().catch(() => {}); }, RECONCILIA_CADA_MS);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { iniciar().catch((e) => console.warn("outbox: iniciar falhou:", (e && e.message) || e)); });
  } else {
    iniciar().catch((e) => console.warn("outbox: iniciar falhou:", (e && e.message) || e));
  }

  /* ======================= contrato público ======================= */
  return {
    enfileirar,     // (op) -> {op, jaExistia} — recusa operationId duplicado na fila
    processar,      // escoa a fila em ordem (no-op offline/sem login)
    reconciliar,    // confirma pelo servidor o que ficou "enviando"/"falha" com Operation_ID
    tentarAgora,    // (operationId) retry manual — inclusive de falha permanente
    descartar,      // (operationId, motivo) — motivo obrigatório, registro fica na trilha
    listar,         // snapshot ordenado da fila
    ehErroDeRede,   // (e) — usado pelas telas para decidir o desvio pra fila
    iniciar         // idempotente; auto-chamado no load do script
  };
})();
