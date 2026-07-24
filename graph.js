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

  // helpers de formatação
  const BRL = (n) => (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmtDate = (s) => { if (!s) return null; const d = new Date(s); return isNaN(d) ? s : d.toLocaleDateString("pt-BR"); };

  return { CONFIG, GRAPH, init, login, logout, getAccount, token, gget, gpatch, me, resolveSite, listItems, listColumns, patchItemFields, BRL, fmtDate };
})();
