const fs=require('fs'),vm=require('vm'),path=require('path');
const SRC=fs.readFileSync(path.resolve(__dirname,'..','..','crm-auditoria.js'),'utf8');
let pass=0,fail=0;const check=(n,c,d)=>{if(c){pass++;console.log('OK   '+n)}else{fail++;console.log('FAIL '+n+(d?' -- '+d:''))}};
function makeSandbox(opts={}){
  const created=[];const state={items:(opts.items||[]).slice(),created};
  const choice=(name,choices)=>({name,choice:{choices}});
  const columns=opts.columns||[
    {name:'Submission_ID',enforceUniqueValues:true},choice('Origem_Lead',['Inbound','Outbound','Licitações','Indicação']),{name:'ID_Origem'},{name:'Data_Recebimento'},
    choice('Status_Processamento',['Recebido','Em processamento','Processado','Erro','Classificado']),choice('Status_Auditoria',['Não iniciada','Pendente','Aprovado','Rejeitado']),choice('Status_Promocao',['Não aplicável','Pendente','Em processamento','Promovido','Erro']),
    {name:'Tipo_Documento'},{name:'Documento_Normalizado'},{name:'Title'},{name:'Dados_Brutos'},{name:'RazaoSocial_Nome'},{name:'Chave_Dedupe'}
  ];
  const sandbox={console,Date,window:{},EG:{async listColumns(){return columns},async listItems(){return state.items},async createItem(list,fields){created.push({list,fields});const item={id:String(100+created.length),fields:{...fields}};state.items.push(item);return item}}};
  vm.createContext(sandbox);vm.runInContext(SRC,sandbox,{filename:'crm-auditoria.js'});return{api:sandbox.window.CRMAuditoria,state};
}
(async()=>{
  const{api,state}=makeSandbox();check('1 regras puras verdes',api.assertRegras().ok===true);
  const schema=await api.inspecionarSchema();check('2 schema v1.1 completo',schema.ok===true&&schema.faltando.length===0);check('3 Submission_ID UNIQUE detectado',schema.submissionUnique===true);
  const lead={origem:'Indicação',submission_id:'IND-001',origem_id:'IND-001',razao_social_nome:'Empresa Teste Ltda',tipo_documento:'CNPJ',documento:'11.222.333/0001-81',contexto:'demanda A',status_auditoria:'Pendente'};
  const r1=await api.registrar(lead,{meta:{produtor:'teste'}});check('4 primeira submissão cria',r1.criado===true&&state.created.length===1,JSON.stringify(r1));
  const f=state.created[0].fields;check('5 grava identidades canônicas',f.Submission_ID==='IND-001'&&f.ID_Origem==='IND-001'&&f.Origem_Lead==='Indicação');check('6 documento é normalizado mas não vira dedupe',f.Documento_Normalizado==='11222333000181'&&f.Chave_Dedupe==='IND-001');
  const env=JSON.parse(f.Dados_Brutos);check('7 envelope v2 possui fingerprint',env._crm.envelope_version===2&&env._crm.submission_id==='IND-001'&&!!env._crm.payload_fingerprint);
  const r2=await api.registrar({...lead});check('8 T06 retry idêntico reutiliza submissão',r2.duplicado===true&&state.created.length===1,JSON.stringify(r2));
  let conflict=false;try{await api.registrar({...lead,contexto:'payload alterado'})}catch(e){conflict=e.code==='SUBMISSION_CONFLICT'}check('9 mesmo Submission_ID + payload divergente conflita',conflict===true);
  const nova={...lead,submission_id:'IND-002',origem_id:'IND-002',razao_social_nome:'Empresa Teste LTDA — nova demanda',contexto:'demanda B'};const r3=await api.registrar(nova);check('10 T13 mesmo CNPJ + nova submissão cria nova oportunidade potencial',r3.criado===true&&state.created.length===2,JSON.stringify(r3));
  check('11 T14 razão social variante não altera Documento_Normalizado',state.created[1].fields.Documento_Normalizado===state.created[0].fields.Documento_Normalizado);
  let noIdentity=false;try{await api.registrar({origem:'Indicação',documento:'11222333000181'})}catch(e){noIdentity=/Submission_ID/.test(e.message)}check('12 documento sozinho não identifica lead',noIdentity===true);
  const missing=makeSandbox({columns:[{name:'Submission_ID'},{name:'Origem_Lead'}]});let blocked=false;try{await missing.api.registrar(lead)}catch(e){blocked=!!e.failClosed}check('13 schema incompleto bloqueia antes de escrever',blocked&&missing.state.created.length===0);
  const badChoice=makeSandbox();let choiceBlocked=false;try{await badChoice.api.registrar({...lead,status_auditoria:'Inventado'})}catch(e){choiceBlocked=/não existe no SharePoint/.test(e.message)}check('14 Choice divergente bloqueia escrita',choiceBlocked===true);
  check('15 núcleo não cria Proposta/Cliente',!/createItem\s*\(\s*["'](?:Propostas|Clientes)["']/.test(SRC));
  console.log(`\nCRM auditoria v1.1: ${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
