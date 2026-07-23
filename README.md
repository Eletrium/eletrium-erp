# Eletrium ERP — Web

App web do ERP Eletrium. **Separado** do repositório do Power Platform
(`C:\EletriumERP\ERPEletrium`, que contém canvas apps + flows). Aqui vive o front-end web que
consome o SharePoint via Microsoft Graph com **autenticação delegada**.

## Auth

Login individual delegado (cada usuário entra com a própria conta). Referência completa:
`..\ERPEletrium\docs\AUTH-DELEGADO.md`.

- App: **Eletrium ERP - Web App** · client id `f0c63078-fe75-4f7a-8f87-8783c12e7df8`
- Tenant: `6b76ebcc-abef-462d-a0be-eebf5a9e434b` (Gwtech Elétrica e Automação)
- Plataforma **SPA** · redirect `http://localhost:3000`
- Permissões delegadas: `User.Read`, `Sites.Read.All` (consentidas)
- MSAL Browser v3 (CDN), login por popup, Authorization Code + PKCE

> **Não é app-only.** O app de automação (`03c9dd05-…`, certificado, `Sites.Selected`) é outro e
> serve só para bastidor (monitoramento de flows). Constatado em 23/07: aquele app funciona para
> SharePoint REST (PnP) mas **não** para Graph — por isso o front usa o app delegado.

## Rodar

```
node server.js
```
Abrir `http://localhost:3000` no navegador → **Entrar** → **Carregar Propostas**.

## Estado atual (23/07/2026)

Seed do Kanban de Propostas. `index.html` faz, via Graph delegado:
1. Resolve o site `EletriumERP`.
2. Lê os choices de `Etapa_Pipeline` (definição de coluna) — as 8 colunas do Kanban.
3. Lê os itens de `Propostas` (campos de card).
4. Lê `Clientes` e faz o join `ClienteLookupId → Título`, porque no Graph o lookup `Cliente`
   volta só como id, não como nome.

Renderiza os choices como chips e cada proposta como um mini-card (Número, Cliente, Valor, Etapa).

### Dados reais confirmados

- **Campos de card:** `Title` (número), `Cliente` (lookup → nome), `ValorTotal`, `Etapa_Pipeline`.
- **Etapas (colunas), na ordem:** Lead Novo · Qualificação · Em Elaboração · Enviada ·
  Em Negociação · Aguardando Decisão · Ganho · Perdido. **Têm acento** — comparar exato.
- **Volume:** 1 proposta hoje (nº `26.0307.001`, Cliente Teste CRM Ltda, R$ 15.000, etapa "Ganho").

## Kanban (feito)

`renderBoard()` agrupa as propostas em 8 colunas por `Etapa_Pipeline`, **na ordem dos choices do
SharePoint**, com a cor de cada coluna vinda do `ETAPA_CONFIG`. Cabeçalho de cada coluna mostra a
contagem e a soma de `ValorTotal`. Cards com etapa nula/fora dos choices vão para uma coluna
**"(sem etapa)"** — nada é escondido (o oposto do bug do Kanban do canvas). Com 1 proposta hoje, o
board nasce com o card em "Ganho" e as demais colunas vazias.

## Próximos passos

- Massa de dados de teste para validar o visual com colunas povoadas.
- Mover card entre etapas (drag-drop) → exige **escrita** via Graph (`PATCH` no item), o que precisa
  de permissão delegada de escrita (`Sites.ReadWrite.All` ou `Sites.Selected` no app) — hoje o app só
  tem `Sites.Read.All`. Decisão de escopo antes de implementar.
- Abrir detalhe da proposta ao clicar no card.

## Notas

- Pasta de bancada `..\ERPEletrium\...\scratchpad\msal-test\` foi o teste de auth original; este
  projeto é a evolução dele para dados reais de Propostas.
- Ainda sem build/toolchain — HTML + MSAL via CDN + servidor estático. Introduzir bundler só quando
  a complexidade justificar.
