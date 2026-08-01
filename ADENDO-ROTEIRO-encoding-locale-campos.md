# Adendo ao roteiro de teste — encoding, locale e nomes reais de campo

Análise **estática** do código em `C:\EletriumERP\web` (29/07/2026).
Escopo pedido: mojibake/locale + confirmação de nomes de campo direto no código.

**Método e limite:** nada aqui foi executado. Sem shell (sandbox Linux indisponível — falta
de disco), sem `node server.js`, sem Playwright, sem query no SharePoint. Toda afirmação
abaixo é leitura de fonte, com arquivo e linha. Onde o veredito depende do schema do
SharePoint, está marcado **[PRECISA QUERY]** — não convertido em asserção.

---

## 0. Três premissas do roteiro que o código contradiz

Leia antes do resto: elas mudam o que faz sentido testar.

### 0.1 `server.js` é um servidor estático de 21 linhas

Sem rotas, sem sessão, sem auth, sem cliente SharePoint. `findstr "app.get app.post"`
retorna **nada** — não porque as rotas estão escondidas, mas porque não existem. As "telas"
são arquivos `.html` servidos por caminho.

Consequências diretas:

- **Não existe validação server-side em lugar nenhum.** O teste 4 da Tela 11
  (`curl -X POST ... -d "nome=&email=invalido"`) é inexecutável: o servidor ignora o método
  HTTP, lê o arquivo e devolve 200 com o HTML. Não há handler de POST para validar.
- `server.log` terá só a linha de boot. Erro de aplicação só aparece no **console do browser**.
- O PIN (1234 / 5678) não existe no frontend web — é do PWA/canvas.

### 0.2 Auth é MSAL client-side, delegada de verdade

`graph.js` linhas 4–32: `clientId f0c63078-fe75-4f7a-8f87-8783c12e7df8`,
tenant `6b76ebcc-abef-462d-a0be-eebf5a9e434b`, site
`gwtecheletrica.sharepoint.com/sites/EletriumERP`, scopes `User.Read` + `Sites.ReadWrite.All`,
cache em `sessionStorage`. Todo write vai **do browser direto ao Graph** — não passa pelo
`server.js`.

### 0.3 O banner de Choice não olha a planilha — o Bloco 0 está errado

`EG.validarChoices(lista, campo, chavesLocais)` (graph.js:104–121) compara:

- **lado A:** `col.choice.choices` — os valores reais da coluna Choice no SharePoint, via
  `listColumns`;
- **lado B:** `chavesLocais` — rótulos **hard-coded no HTML da tela**.

`Opcoes_Resposta` não entra na conta. Grep em `/web`: **zero ocorrências** de
`Opcoes_Resposta`, `Perguntas_Checklist`, `Materiais_OS`, `Fotos_OS`, `Proposta_Historico`.

Portanto:

- **Deduplicar a planilha não muda o banner.** A ordem imposta pelo Bloco 0 é desnecessária
  para testar o banner. (A dedupe continua necessária por outros motivos — só não é
  pré-requisito deste teste.)
- **Todo o Bloco 4 é inaplicável ao frontend web.** As 96 opções, os 12 `Aciona_NC`, a
  distribuição de `Cor_Indicador`, o filtro das 7 perguntas — nada disso é lido por estas
  telas. Vale para o PWA/canvas de checklist, não aqui.
- O banner tem duas direções, e a mais perigosa é a segunda:
  `semChoice` = está no código e não existe no SP (filtro nunca casa);
  `semConfig` = existe no SP e o código não trata (cai no fallback e **o número fica errado
  em silêncio**). `dashboard.html` passa `{apenasSemChoice:true}` em `Tipo_OS_Completo` e
  `Categoria` (551–552), suprimindo essa segunda direção de propósito.

---

## 1. Mojibake — não é produzido por este repositório

`ð¢` é 🟢 (U+1F7E2, bytes UTF-8 `F0 9F 9F A2`) decodificado como CP1252/Latin-1.
Assinatura de round-trip por um leitor CP1252 — classicamente **Excel abrindo um CSV UTF-8
sem BOM**.

A cadeia do repo está limpa em UTF-8:

| Ponto | Estado |
|---|---|
| `<meta charset="utf-8">` | presente nos 12 HTML (linha 4 de cada) |
| `server.js:9` | `.html` sai com `text/html; charset=utf-8` |
| `graph.js` | `fetch` + `JSON.stringify`/`.json()` — UTF-8 por especificação, sempre |
| `pncp-radar.js:871,969,970` | `readFileSync`/`writeFileSync` com `"utf8"` explícito |

Único ponto de decode de bytes em todo o repo:
`ImportarFaturaCSV-40B3E955...json:97` →
`@base64ToString(triggerBody()?['file']?['contentBytes'])`.
`base64ToString()` do Power Automate decodifica como **UTF-8** — não produz `ð¢`. Se o CSV
de entrada estiver em ANSI/CP1252, o defeito sai na direção **oposta** (`Ã©`, `Ã§`), não nesta.

**Conclusão:** a corrupção é anterior ao código, no caminho planilha→SharePoint.
**Não confirmado** qual etapa — candidato mais provável é o cenário Make, mesmo suspeito da
duplicação por *append*. Ver §4.

**Ressalva menor, real mas de baixo impacto:** `server.js:9` só declara charset para `.html`.
`.js`, `.css` e `.json` saem sem. Inofensivo na prática (script clássico herda o encoding do
documento; JSON é UTF-8 por spec e `response.json()` sempre decodifica UTF-8), mas é uma
linha para corrigir.

**Implicação para o teste:** como a corrupção está *armazenada*, a tela vai exibir `ð¢`
fielmente. Isso **confirma** que o mojibake é de escrita, e não é bug da tela. Não reporte
como achado novo — reporte se aparecer `ï¿½` ou `?`, que indicaria uma segunda perda.

---

## 2. Locale — o risco real é **zerar**, não inflar

### 2.1 `7,5` nunca vira `75`

Não existe parse pt-BR em nenhuma tela. Todas usam `Number(v)`:
`os.html:156`, `suprimentos.html:170`, `fechamentos.html:254`, `faturamento.html:262`,
`dashboard.html:186`, `nova-proposta.html:300`.

`Number("7,5")` é **`NaN`** — nunca `75`. O medo do roteiro (Tela 5 item 4, Tela 10 item 5)
é infundado nessa forma.

### 2.2 O bug de verdade: `NaN` → `0` silencioso

Três telas coagem `NaN` para zero em somas de dinheiro e horas:

- `os.html:156` — `Number(v) || 0`
- `faturamento.html:262` — `isNaN(n) ? 0 : n`
- `dashboard.html:186` — `Number.isFinite(n) ? n : 0`

Um valor com vírgula decimal armazenado em coluna **Text** entra como `0` no total, sem
aviso. É a mesma família do "número errado em silêncio" que o banner de Choice combate —
mas aqui não há banner.

**`fechamentos.html` é a exceção correta e o padrão a copiar:** `ehNum` (263), `cel` (266),
`celBRL` (270) mostram `"—"` quando o campo não é numérico, com o comentário explícito
"zero é um número afirmativo e mentiria sobre o dado" (261–262).

**[PRECISA QUERY]** Se `Latitude`, `Longitude`, `Horas_*` e os campos monetários forem coluna
**Number** no SharePoint, o Graph devolve número JSON e nada disso dispara — vírgula decimal
é representação de *planilha*. Rode antes de julgar:

```powershell
Get-PnPField -List "Clientes" | Where InternalName -in "Latitude","Longitude" |
  Select InternalName, TypeAsString
```

Só há bug se `TypeAsString` for `Text`.

### 2.3 Formatação de saída está correta

`EG.BRL` (graph.js:85) usa `toLocaleString("pt-BR", {style:"currency"})` → `R$ 1.234,56`.
`fmtPct` (dashboard.html:194) e os `toFixed().replace(".", ",")` (441–442) trocam o separador
certo. `R$` e `%` não são pontos de falha.

### 2.4 Achado novo: **erro de 1 dia** em campos date-only

`graph.js:86` — `fmtDate = (s) => new Date(s).toLocaleDateString("pt-BR")`
`fechamentos.html:273` — `parseD = (s) => new Date(s)`
`fechamentos.html:275–279` — `dKey` deriva `AAAA-MM-DD` da data **local**

Campo *Date only* do SharePoint volta do Graph como `"2026-06-12T00:00:00Z"`. `new Date()`
interpreta como meia-noite **UTC**; em America/São_Paulo (UTC−3) isso é 21:00 do dia **11**.
Resultado: `11/06/2026` exibido onde o dado é `12/06/2026`. E `dKey` erra do mesmo jeito, o
que desloca **o filtro por dia** junto com a exibição.

Afeta `EG.fmtDate(f.DataConclusao)` (`os.html:264`) e tudo que passa por `parseD`/`dKey`.

**Não afeta** campos Date+Time reais: `Data_Aprovacao` é gravado como
`new Date().toISOString()` (`fechamentos.html:836`) — timestamp verdadeiro, convertido de
volta corretamente por `fmtDT` (280).

**Correção para o Bloco 9 do roteiro:** diferença de **exatamente 3h** em `Data_Aprovacao`
**não** é o defeito esperado — o código faz UTC→local certo. O defeito esperado é
**1 dia a menos** em campo date-only. Procure a coisa certa.

---

## 3. Nomes reais — `[DESCOBRIR]` resolvidos

### 3.1 Telas: são 12, não 11

`index` (Kanban) · `clientes` · `propostas` · `nova-proposta` · `os` · `suprimentos` ·
`dashboard` · `habilitacoes` · `faturamento` · `fechamentos` · `inbound` · **`reaquecimento`**

`reaquecimento.html` não está no roteiro (lê `Clientes` + `Status_Relacionamento`).
`pncp-radar-data/radar-editais.html` é artefato gerado por `pncp-radar.js`, não é tela.

### 3.2 Listas por tela

| Tela | Listas SharePoint lidas |
|---|---|
| index (Kanban) | `Propostas`, `Clientes` |
| propostas | `Propostas`, `Clientes` |
| nova-proposta | `Clientes` (escreve em `Propostas` / `Orcamentos_Venda`) |
| clientes | `Clientes` |
| reaquecimento | `Clientes` |
| os | `OrdensDeServico`, `Clientes`, **`TecnicosMEI`** |
| dashboard | `OrdensDeServico`, `Clientes` |
| suprimentos | `Orcamentos_Venda`, `Produtos`, `Itens_Orcamento_Venda`, `Clientes` |
| faturamento | `Orcamentos_Venda`, `Notas_Fiscais_Entrada`, `Clientes`, `Fornecedores` |
| habilitacoes | `Tecnico_Qualificacoes`, `TecnicosMEI`, `Nivel_Qualificacoes_Exigidas` |
| fechamentos | `Fechamento_Mensal_Tecnico`, `Diaria_Tecnico`, `Veiculos_Tecnicos`, `TecnicosMEI` |
| inbound | nenhuma — POST para webhook do Make |

Correções ao roteiro:

- A lista de técnicos é **`TecnicosMEI`**, não `Tecnicos`.
- **Tela 6 (Suprimentos) não lê `Materiais_OS` nem `Fotos_OS`** — nem `Compras`,
  `Cotacoes_Fornecedor`, `Solicitacoes_Compra`. O teste de "estado vazio" dessas duas listas
  não se aplica a esta tela. O escopo real é orçamento de venda.
- **Nada lê `Proposta_Historico`.** Tela 1 item 5 respondido: o app web **não** registra
  histórico de transição. Se deveria, é decisão de produto, não bug de implementação.

### 3.3 Kanban (Tela 1) — campo de etapa

**`Etapa_Pipeline`**, na lista `Propostas`. Confirmado em `pipeline.js:3`,
`propostas.html:63`, `index.html:158,202,235,241,245`.

Oito etapas hard-coded em `pipeline.js:9–18`, com acento:
`Lead Novo` · `Qualificação` · `Em Elaboração` · `Enviada` · `Em Negociação` ·
`Aguardando Decisão` · `Ganho` · `Perdido`

A escrita do arraste (`index.html:241`) é:

```js
const body = { Etapa_Pipeline: novaEtapa, Data_Entrada_Etapa: new Date().toISOString() };
```

Então grave também `Data_Entrada_Etapa` na verificação de nível 4 — não só a etapa.
O comentário em `pipeline.js:7` diz que o bug antigo do Kanban foi exatamente
`"Qualificacao"` ≠ `"Qualificação"`, e `validateEtapasConfig()` existe para pegar isso.

### 3.4 Fechamentos (Tela 9) — `Aprovado_Por` **não é campo Person**

`fechamentos.html:833–842`:

```js
const campos = {
  Status_Aprovacao: decisao,                                  // "Aprovado" | "Rejeitado"
  Aprovado_Por: usuarioNome || "(usuário não identificado)",  // TEXTO
  Data_Aprovacao: new Date().toISOString(),
  Alteracao_Pendente: false,
  Motivo_Rejeicao: decisao === "Rejeitado" ? motivo : ""
};
```

`usuarioNome` vem de `EG.me().nome` = `displayName` do Graph `/me` (302, 311–312).

Cinco correções ao roteiro:

1. **É texto puro, não Person.** A query do Bloco 6
   `$v["Aprovado_Por"] | Select LookupId, LookupValue, Email` não vai funcionar. Use
   `$v.FieldValues["Aprovado_Por"]` e espere uma string.
2. **O achado "sério" antecipado não existe.** O campo grava o humano delegado real, não
   conta de serviço, não o app. E o comentário em 786–788 registra que o flow
   *Eletrium - Aprovacao de Veiculo* apenas **lê** `Status_Aprovacao`/`Alteracao_Pendente`
   para mandar e-mail — não escreve nesses campos. Sem disputa de identidade.
3. **Achado menor, mas real:** grava só `displayName`, sem e-mail nem ID. Dois usuários
   homônimos ficam indistinguíveis na trilha de auditoria. `EG.me()` já tem `email` em mãos
   (graph.js:54) — não custaria nada gravar.
4. **Rejeição preenche `Aprovado_Por` de propósito** (comentário em 797–798: a lista não tem
   `Rejeitado_Por`). É decisão documentada, não bug semântico. Julgue como tradeoff.
5. **Idempotência (item 7) respondido:** `Data_Aprovacao` é **sobrescrita** a cada decisão,
   sem guarda. Há botão "Rever decisão" (811, 816) que reabre o bloco de ação.

Detalhe que ajuda o teste: a tela **relê do servidor** após o PATCH (849–855), justamente
para não confiar no eco local. Isso cobre parte do nível 4 dentro da própria tela — mas
confirme por query de qualquer forma, porque a releitura usa o mesmo token e o mesmo caminho.

`Alteracao_Pendente: false` vai junto por necessidade: o flow dispara em modificação com
condição `Cadastrado_Por = 'Tecnico (PWA)' AND (Status_Aprovacao = 'Pendente' OR
Alteracao_Pendente = true)` (790–795). Sem zerar, cada aprovação mandaria novo e-mail de
"pendente".

### 3.5 Inbound (Tela 11) — não escreve no SharePoint

`inbound.html:682` faz `POST` para
`WEBHOOK_URL = "https://hook.us2.make.com/a10t2t8iq54n667dk66t7mawvtzovr9b"` (291).
`ORIGEM_LEAD = "Inbound"` alimenta `Origem_Lead` na lista **`Fila_Auditoria_Leads`** (300) —
não `Leads_Ads` nem `Leads_Outbound`.

Há um guard (663–673): se `WEBHOOK_URL` for placeholder, o POST é bloqueado e o formulário
não é limpo. Hoje **está configurado**, então o submit vai sair de verdade — marque o lead
de teste de forma óbvia.

Dois pontos para o relatório:

- A validação é **100% client-side** (`inbound.html:560` e vizinhança). Não há servidor para
  validar: o destino é o Make. O teste de contorno do JS deve ser feito **contra o webhook**,
  não contra `localhost:3000` — e isso grava dado real, então decida se quer fazer.
- A URL do webhook está **em texto claro numa página pública**, sem autenticação. Qualquer
  pessoa pode postar payload arbitrário direto no cenário. O comentário em 289 diz "NUNCA
  acrescente token/API key nesta página" — correto, mas o endpoint em si é a exposição.
  Item 5 do roteiro (rate limit / anti-bot) precisa ser respondido **no Make**, não na tela.

### 3.6 Mapa completo do que o banner vigia

| Tela | Lista | Campo |
|---|---|---|
| clientes | `Clientes` | `TipoPessoa`, `Estado`, `Segmento`, `Status`, `Status_Relacionamento`, `Origem_Lead`, `Frequencia_Compra` |
| reaquecimento | `Clientes` | `Status_Relacionamento` |
| propostas | `Propostas` | `Etapa_Pipeline` |
| nova-proposta | `Propostas` | `Tipo_Servico_Proposta`, `Canal_Venda` |
| nova-proposta | `Orcamentos_Venda` | `Origem_Demanda`, `Status_Orcamento` |
| os | `OrdensDeServico` | `Status` |
| dashboard | `OrdensDeServico` | `Status`, `Tipo_OS`, `Tipo_OS_Completo`*, `Categoria`* |
| suprimentos | `Orcamentos_Venda` | `Status_Orcamento` |
| faturamento | `Orcamentos_Venda` / `Notas_Fiscais_Entrada` | `Status_Orcamento` / `Status_Processamento` |
| habilitacoes | `Tecnico_Qualificacoes` / `Nivel_Qualificacoes_Exigidas` | `Status_Validade` / `Nivel_Tecnico` |
| fechamentos | `Fechamento_Mensal_Tecnico` | `Status_Pagamento`, `Mes` |
| fechamentos | `Diaria_Tecnico` | `Status_Dia`, `Classificacao_Jornada` |
| fechamentos | `Veiculos_Tecnicos` | `Status_Aprovacao` |

\* com `{apenasSemChoice:true}` — a direção "existe no SP e o código ignora" está suprimida.

Banner **fora** desta tabela é falso positivo por definição — filtro mais útil que o das
7 perguntas do Bloco 4, que aqui não se aplica.

### 3.7 Conflito de fixture: `Segmento`

`clientes.html:115` hard-codeia `"Indústria"`. O Bloco 2 do roteiro diz que `CLI-001` e
`CLI-003` são `Industrial`. **`"Indústria"` ≠ `"Industrial"`.**

O comentário em 107 afirma que os enums foram levantados com `Get-PnPField` em 29/07/2026 —
ou seja, o código diz bater com o SharePoint, e a divergência seria da planilha.

**[PRECISA QUERY]** — decide qual dos dois está certo e evita um falso achado:

```powershell
(Get-PnPField -List "Clientes" -Identity "Segmento").Choices
```

Se o SP disser `Indústria`, o teste "filtro por Segmento (Industrial deve dar 2)" da Tela 2
falha **por expectativa errada do roteiro**, não por bug. Se disser `Industrial`, o banner
vai acusar `semChoice: ["Indústria"]` e o filtro realmente nunca casa — aí é bug de verdade.

---

## 4. Causa raiz da duplicação — para onde apontar

O roteiro suspeita de `append` onde devia haver `upsert/replace`, e não conseguiu confirmar o
cenário Make. Dois reforços da leitura de código:

1. `inbound.html` prova que **existe integração Make ativa** e dá o hook exato:
   `hook.us2.make.com/a10t2t8iq54n667dk66t7mawvtzovr9b`. É o fio para puxar.
2. Nenhuma tela web escreve em `Opcoes_Resposta`, `OrdensDeServico` em lote, ou qualquer
   lista de forma que empilhe camadas. Todas as escritas são `patchItemFields` por item ou
   `createItem` unitário disparado por clique. **A duplicação não vem do frontend web.**

Sobra o Make e os 9 flows do Power Automate. `ImportarFaturaCSV` é o único flow do repo que
processa lote (CSV → script), e é o candidato natural a examinar junto do cenário Make.

---

## 5. O que continua NÃO VERIFICADO

Nos termos do Bloco 7 — nada abaixo passou, nada abaixo falhou:

- Bloco 1 inteiro (pré-flight, servidor de pé, ponte).
- As 11/12 telas: nenhuma foi aberta. Zero screenshots, zero console, zero network.
- Persistência níveis 1–4 em Kanban, Fechamentos e Nova Proposta.
- Todas as queries do Bloco 6.
- Histórico de execução dos flows e do cenário Make.
- Tipo real das colunas (`TypeAsString`) — de que dependem §2.2 e §3.7.
- Regra de derivação do Canal de Venda (Tela 4 item 1) — **não analisada**, segue em aberto.
- Existência do item `ID=3` em `Veiculos_Tecnicos`.

**Nenhum registro de teste foi criado.** Nada para limpar.
