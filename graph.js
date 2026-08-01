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

  async function token() {
    const req = { scopes: CONFIG.scopes, account };
    try { return (await msalApp.acquireTokenSilent(req)).accessToken; }
    catch { return (await msalApp.acquireTokenPopup(req)).accessToken; }
  }
  async function gget(url) {
    const t = await token();
    const r = await fetch(url.startsWith("http") ? url : GRAPH + url, { headers: { Authorization: "Bearer " + t, Accept: "application/json" } });
    if (!r.ok) throw new Error(r.status + " " + (await r.text()));
    return r.json();
  }
  async function gpatch(url, body) {
    const t = await token();
    const r = await fetch(url.startsWith("http") ? url : GRAPH + url, { method: "PATCH", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.status + " " + (await r.text()));
    return r.json();
  }
  async function gpost(url, body) {
    const t = await token();
    const r = await fetch(url.startsWith("http") ? url : GRAPH + url, { method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.status + " " + (await r.text()));
    return r.json();
  }
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
  async function listItems(list, query) {
    const sid = await resolveSite();
    const q = query || "expand=fields&$top=500";
    return (await gget("/sites/" + sid + "/lists/" + encodeURIComponent(list) + "/items?" + q)).value || [];
  }
  async function listColumns(list) {
    const sid = await resolveSite();
    return (await gget("/sites/" + sid + "/lists/" + encodeURIComponent(list) + "/columns")).value || [];
  }
  async function patchItemFields(list, id, fields) {
    const sid = await resolveSite();
    return gpatch("/sites/" + sid + "/lists/" + encodeURIComponent(list) + "/items/" + id + "/fields", fields);
  }
  // Cria item. `fields` usa nomes INTERNOS; lookup vai como <Campo>LookupId
  // (ex.: ClienteLookupId: 3) — o Graph não aceita "Cliente" com objeto.
  // Só inclua chaves com valor: campo vazio enviado como "" grava vazio.
  async function createItem(list, fields) {
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

  return { CONFIG, GRAPH, init, login, logout, getAccount, token, gget, gpatch, gpost, me, resolveSite, listItems, listColumns, patchItemFields, createItem, BRL, fmtDate, ehDataPura, validarChoices, renderAvisoChoices, renderAvisosChoices };
})();
