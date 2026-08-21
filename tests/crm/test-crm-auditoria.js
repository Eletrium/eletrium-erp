const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'crm-auditoria.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' -- ' + detail : '')); }
};

function makeSandbox(opts = {}) {
  const created = [];
  const state = { items: (opts.items || []).slice(), created };
  const columns = opts.columns || [
    { name: 'Title' },
    { name: 'Origem_Lead' },
    { name: 'Dados_Brutos' },
    { name: 'RazaoSocial_Nome' },
    { name: 'Chave_Dedupe', enforceUniqueValues: true },
    { name: 'Canal_Origem' },
    { name: 'Origem_ID' },
    { name: 'Link_Origem' }
  ];
  const sandbox = {
    console,
    Date,
    window: {},
    EG: {
      async listColumns(list) {
        if (list !== 'Fila_Auditoria_Leads') throw new Error('lista errada');
        return columns;
      },
      async listItems(list) {
        if (list !== 'Fila_Auditoria_Leads') throw new Error('lista errada');
        return state.items;
      },
      async createItem(list, fields) {
        if (list !== 'Fila_Auditoria_Leads') throw new Error('lista errada');
        created.push({ list, fields });
        const item = { id: String(100 + created.length), fields: { ...fields } };
        state.items.push(item);
        return item;
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'crm-auditoria.js' });
  return { api: sandbox.window.CRMAuditoria, state };
}

(async () => {
  const { api, state } = makeSandbox();
  const pure = api.assertRegras();
  check('1 regras puras verdes', pure.ok === true && pure.total >= 5, JSON.stringify(pure));

  const schema = await api.inspecionarSchema();
  check('2 schema mínimo aceito', schema.ok === true && schema.faltando.length === 0);
  check('3 chave de dedupe UNIQUE detectada', schema.chaveDedupeServerSide === true);

  const lead = {
    origem: 'Indicação',
    razao_social_nome: 'Empresa Teste Ltda',
    documento: '11.222.333/0001-81',
    contato_nome: 'Maria',
    email: 'maria@teste.com.br',
    canal_origem: 'Indicação'
  };
  const r1 = await api.registrar(lead, { meta: { produtor: 'teste' } });
  check('4 primeiro registro cria item', r1.criado === true && r1.duplicado === false && state.created.length === 1, JSON.stringify(r1));
  const f = state.created[0].fields;
  check('5 grava origem/nome/dados crus', f.Origem_Lead === 'Indicação' && f.RazaoSocial_Nome === 'Empresa Teste Ltda' && !!f.Dados_Brutos);
  check('6 grava Chave_Dedupe quando coluna existe', typeof f.Chave_Dedupe === 'string' && f.Chave_Dedupe.startsWith('CRM1-INDICACAO-'));
  const env = JSON.parse(f.Dados_Brutos);
  check('7 envelope preserva dedupe e payload', env._crm.dedupe_key === f.Chave_Dedupe && env.lead.email === 'maria@teste.com.br');

  const r2 = await api.registrar({ ...lead, razao_social_nome: 'Grafia Diferente' });
  check('8 reenvio equivalente não duplica', r2.duplicado === true && r2.criado === false && state.created.length === 1, JSON.stringify(r2));

  const pncpA = api.chaveDedupe({ origem: 'Licitações', origem_id: 'PNCP-ABC', razao_social_nome: 'Órgão A' });
  const pncpB = api.chaveDedupe({ origem: 'Licitações', origem_id: 'PNCP-ABC', razao_social_nome: 'Órgão renomeado' });
  check('9 PNCP usa origem_id estável', pncpA === pncpB);

  const missing = makeSandbox({ columns: [{ name: 'Title' }, { name: 'Origem_Lead' }] });
  let blocked = false;
  try { await missing.api.registrar(lead); } catch (e) { blocked = !!e.failClosed; }
  check('10 schema incompleto bloqueia antes de gravar', blocked === true && missing.state.created.length === 0);

  check('11 núcleo não possui automação de Proposta/Cliente', !/createItem\s*\(\s*["'](?:Propostas|Clientes)["']/.test(SRC));

  console.log(`\nCRM auditoria: ${pass} PASS / ${fail} FAIL`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
