# Radar de Editais PNCP — Eletrium

Script Node que consulta a **API pública de consultas do PNCP** (Portal Nacional de
Contratações Públicas), filtra editais por relevância para a Eletrium e grava os
relevantes em arquivo (JSON consultável + HTML de leitura).

- Arquivo: `pncp-radar.js`
- Saída: `pncp-radar-data/radar-editais.json` e `pncp-radar-data/radar-editais.html`
- Requisitos: **Node >= 18** (usa `fetch` global). Testado em Node v24.14.1.
- **Sem dependências externas. Sem autenticação.**

---

## 🔴 PENDÊNCIA BLOQUEANTE — os critérios ainda NÃO são os reais

Os critérios de relevância no bloco `CONFIG` do topo de `pncp-radar.js` são
**PLACEHOLDER PROVISÓRIO**.

A fonte oficial seria a **Seção 4 de `Perfil_Eletrium_Licitacoes.md`** (escopo
técnico, faixa de valor, prioridade geográfica). **Esse documento não existe no
repositório e o conteúdo não foi fornecido.** Enquanto isso, usamos defaults
conservadores derivados apenas do ramo elétrico conhecido:

| Critério | Valor provisório | Efeito |
|---|---|---|
| `PALAVRAS_CHAVE` | 10 termos (NR-10, NR-12, SPDA, para-raios, aterramento, subestação, instalação elétrica, manutenção elétrica, cabine primária, laudo elétrico) | único filtro que realmente corta |
| `VALOR_MIN` / `VALOR_MAX` | `null` / `null` | **sem filtro de valor** |
| `UFS_PRIORITARIAS` | `[]` | **todas as UFs** |
| `SCORE_MINIMO` | `1` | basta 1 palavra-chave |

**Consequência prática, já observada no teste real:** o filtro deixa passar coisas
fora do negócio — por exemplo um edital de *"Pós-graduação em Instalações Elétricas"*
(curso, não serviço) e contratos de *facilities* genéricos que só mencionam
"manutenção elétrica" no meio de limpeza e portaria. A Seção 4 provavelmente
precisa definir também **termos de exclusão** (curso, capacitação, pós-graduação,
apostila…) e um **valor mínimo**, que hoje não existem.

> **O radar funciona. O filtro ainda não é o filtro do negócio.**

---

## A API do PNCP — o que foi confirmado na prática

Base: `https://pncp.gov.br/api/consulta/v1` · REST · JSON · **pública, sem token**
(autenticação só é exigida nas APIs de *manutenção*/inserção, que não usamos).

Documentação consultada:
- Manual das APIs de Consultas PNCP v1.0 — <https://www.gov.br/pncp/pt-br/pncp/manuais/versoes-anteriores/ManualPNCPAPIConsultasVerso1.0.pdf>
- Manual de Integração PNCP v2.2.1 — <https://www.gov.br/pncp/pt-br/central-de-conteudo/manuais/versoes-anteriores/ManualdeIntegraoPNCPVerso2.2.1.pdf>
- Resumo do manual de consultas — <https://gist.github.com/Micael106/04a3e5515057ab11ea8797603682f0bd>

### Endpoints usados

| Modo | Rota | Obrigatórios | Serve para |
|---|---|---|---|
| `proposta` (padrão) | `GET /v1/contratacoes/proposta` | `dataFinal`, `pagina` | contratações com **recebimento de propostas em aberto** — é o que um radar quer |
| `publicacao` | `GET /v1/contratacoes/publicacao` | `dataInicial`, `dataFinal`, **`codigoModalidadeContratacao`**, `pagina` | editais **publicados** na janela |

Filtros opcionais em ambos: `codigoModalidadeContratacao`, `codigoModoDisputa`,
`uf`, `codigoMunicipioIbge`, `cnpj`, `codigoUnidadeAdministrativa`, `idUsuario`.

### ⚠️ Divergências entre o manual e a API real (medidas em 2026-07-27)

| Item | Manual diz | **Realidade medida** |
|---|---|---|
| `tamanhoPagina` | até **500** | **máximo 50**; `51+` → `400 "Tamanho de página inválido"`; mínimo **10** |
| modalidade em `/proposta` | — | **opcional** (omitir varre todas) |
| modalidade em `/publicacao` | — | **obrigatória** → `400` sem ela |
| janela de `/publicacao` | — | **máx. 365 dias** → `422 "Período inicial e final maior que 365 dias"` |
| rate limit | não documentado | **429 com corpo HTML** (não JSON), **sem** `Retry-After`/`X-RateLimit` |
| estabilidade | — | devolve `500 "Erro na comunicação com o banco de dados"` e timeouts de forma intermitente |

Datas no formato **`AAAAMMDD`**. Paginação devolve `totalRegistros`, `totalPaginas`,
`numeroPagina`, `paginasRestantes`, `empty` e o array `data`.

### Campos reais do registro (confirmados em resposta 200)

`numeroControlePNCP`, `numeroCompra`, `anoCompra`, `sequencialCompra`, `processo`,
`objetoCompra`, `informacaoComplementar`, `valorTotalEstimado`, `valorTotalHomologado`,
`dataAberturaProposta`, `dataEncerramentoProposta`, `dataPublicacaoPncp`,
`dataInclusao`, `dataAtualizacao`, `dataAtualizacaoGlobal`, `modalidadeId`,
`modalidadeNome`, `modoDisputaId`, `modoDisputaNome`, `situacaoCompraId`,
`situacaoCompraNome`, `tipoInstrumentoConvocatorioCodigo`,
`tipoInstrumentoConvocatorioNome`, `srp`, `linkSistemaOrigem`, `linkProcessoEletronico`,
`justificativaPresencial`, `usuarioNome`, `emendaParlamentar`, `fontesOrcamentarias`,
e os aninhados `amparoLegal{codigo,nome,descricao}`,
`orgaoEntidade{cnpj,razaoSocial,poderId,esferaId}`,
`unidadeOrgao{codigoUnidade,nomeUnidade,codigoIbge,municipioNome,ufSigla,ufNome}`,
`orgaoSubRogado`, `unidadeSubRogada`.

> Atenção a duas pegadinhas: é `orgaoEntidade.razaoSocial` (o manual escreve
> `razaosocial`) e `tipoInstrumentoConvocatorio**Codigo**` (o manual escreve `...Id`).

---

## Uso

```bash
node pncp-radar.js                    # propostas em aberto, 60 dias, varredura completa
node pncp-radar.js --dias 30          # horizonte de encerramento
node pncp-radar.js --max-paginas 30   # limita a varredura (teste rápido)
node pncp-radar.js --modo publicacao  # editais publicados na janela
node pncp-radar.js --uf SP,MG         # sobrepõe UFS_PRIORITARIAS
node pncp-radar.js --saida ./outro    # outro diretório de saída
node pncp-radar.js --help
```

**Sobre o tempo de execução:** a varredura nacional completa é cara. Com ~27 mil
contratações abertas, 50 por página e 2 s entre requisições (cadência necessária
para não tomar 429), são ~545 páginas ≈ **18 minutos**. Configurar
`UFS_PRIORITARIAS` reduz drasticamente o volume. `--max-paginas` serve para teste
e sempre marca a saída como **VARREDURA PARCIAL** — nunca finge cobertura total.

---

## Fórmula do score

```
score = (nº de PALAVRAS_CHAVE DISTINTAS encontradas no texto do objeto)
      + 2   se a UF do órgão está em UFS_PRIORITARIAS   (só se configurada)
      + 1   se valorTotalEstimado está dentro da faixa   (só se configurada)
```

- Texto analisado: `objetoCompra` + `informacaoComplementar`.
- Entra no radar quem tiver **≥ 1 palavra-chave** e **score ≥ `SCORE_MINIMO`**.
- Ordenação: score decrescente, depois encerramento mais próximo.

### Como as palavras-chave casam

Os termos são escritos como **radicais (stems)**, e o matcher permite até 3 letras
extras no fim de cada palavra — assim plural e flexão são cobertos sem duplicar
entradas:

- `"instalac eletric"` → casa "instalação elétrica", "instalações elétricas"
- `"subestac"` → casa "subestação", "subestações"

A comparação é **sem acento e sem diferenciar maiúsculas**
(`normalize("NFD")` + remoção de diacríticos). Há ainda um match "colado"
(*squash*) que ignora separadores, então `"nr 10"` casa com **NR-10**, **NR 10** e
**NR10**. Validado por 13 casos de teste (10 positivos, 3 negativos), todos passando.

### Transparência do funil

O script **nunca descarta em silêncio**. Cada execução imprime quantos registros a
API informou, quantas páginas leu, quantos duplicados caíram e quantos foram
reprovados em **cada** filtro (palavra-chave → UF → valor → score mínimo). Os mesmos
números vão para `estatisticasUltimaExecucao` no JSON.

Regra deliberada: **edital sem `valorTotalEstimado` não é descartado** pelo filtro de
valor (apenas não ganha o bônus) — descartar seria perder oportunidade por omissão do órgão.

---

## Robustez e idempotência

- **Timeout** de 60 s por requisição (`AbortSignal.timeout`).
- **Retry com backoff exponencial** (5 s → 10 s → 20 s…, 6 tentativas) em `429`,
  `5xx`, timeout e falha de rede. `400`/`422` **não** são repetidos (erro de
  parâmetro; retry não resolve) e produzem mensagem explicativa.
- **Throttle** de 2 s entre requisições.
- **Deduplicação** por `numeroControlePNCP`, necessária porque o mesmo edital pode
  vir em mais de uma combinação modalidade × UF.
- **Idempotente**: o JSON é um *store* cumulativo indexado por `numeroControlePNCP`.
  Rodar duas vezes atualiza o registro e preserva `primeiroContatoEm`; não duplica.
  *(Verificado: 2ª execução → "10 editais (0 novos, 10 atualizados)".)*
- **Sem stack trace cru**: falhas viram mensagem em português para o operador.
- Lista vazia e `204 No Content` são tratados como resultado válido, não como erro.

## Saída

- **`radar-editais.json`** — store consultável: critérios usados, estatísticas do
  funil, e o array `editais`.
- **`radar-editais.html`** — página estática **autocontida** (dados embutidos), abre
  com duplo clique via `file://`. Não usa MSAL nem `graph.js`: **não** é tela do ERP
  autenticado. Os dados são embutidos justamente porque `fetch` de JSON local seria
  bloqueado por CORS em `file://`.

O diretório `pncp-radar-data/` tem um `.gitignore` próprio (`*` + `!.gitignore`), então
os dados gerados não são versionados e o `.gitignore` da raiz — compartilhado com as
outras frentes — não foi tocado.

---

## 📋 PROPOSTA de schema da lista SharePoint `Radar_Editais` — **NÃO CRIADA**

> **Nada foi criado no SharePoint.** O que segue é uma **proposta para aprovação do
> dono**. Só depois do "ok" é que alguém cria a lista. O script hoje grava em arquivo
> justamente porque isso é local e reversível.

Lista sugerida: **`Radar_Editais`**

| Nome interno | Título | Tipo | Por que existe |
|---|---|---|---|
| `Title` | Nº Controle PNCP | Texto (linha única) | **Chave natural** (`numeroControlePNCP`, ex.: `90940172000138-1-000021/2026`). É por ele que se faz a deduplicação/upsert — deve ser **único** |
| `Objeto` | Objeto | Múltiplas linhas (texto puro) | Descrição do edital; base de toda a triagem humana |
| `Score` | Score | Número (inteiro) | Ordenação por relevância; permite view "Score ≥ 2" |
| `PalavrasChave` | Palavras-chave | Texto (linha única) | Termos que casaram, separados por `;`. Justifica **por que** entrou — auditável |
| `Orgao` | Órgão | Texto (linha única) | Quem contrata |
| `CnpjOrgao` | CNPJ do órgão | Texto (linha única) | Cruzar com cliente/histórico já existente no ERP |
| `UF` | UF | Escolha (27 UFs) | Filtro/agrupamento geográfico — o mais usado nas views |
| `Municipio` | Município | Texto (linha única) | Avaliar deslocamento/logística |
| `ValorEstimado` | Valor estimado | Moeda (BRL) | Triagem por porte; **permitir vazio** (nem todo edital informa) |
| `Modalidade` | Modalidade | Escolha | Pregão-Eletrônico, Dispensa, Credenciamento… muda o rito de participação |
| `DataAberturaProposta` | Abertura | Data e Hora | Quando começa a receber proposta |
| `DataEncerramentoProposta` | Encerramento | Data e Hora | **Prazo** — dispara alerta/lembrete; campo mais crítico da operação |
| `DataPublicacaoPncp` | Publicado em | Data e Hora | Antiguidade do edital |
| `LinkPncp` | Link PNCP | Hiperlink | Abrir a página oficial do edital |
| `LinkSistemaOrigem` | Link origem | Hiperlink | Portal onde a disputa acontece (pode vir vazio) |
| `StatusTriagem` | Status da triagem | Escolha: `Novo` / `Em análise` / `Vamos participar` / `Descartado` | **Campo humano** — o radar sugere, a pessoa decide. Nunca sobrescrito pelo script |
| `MotivoDescarte` | Motivo do descarte | Texto (linha única) | Alimenta o refinamento dos critérios ao longo do tempo |
| `PrimeiroContatoEm` | Detectado em | Data e Hora | Quando o radar viu pela 1ª vez (preservado em reexecuções) |
| `UltimoContatoEm` | Visto por último | Data e Hora | Se parar de aparecer, o edital saiu do ar/encerrou |

**Observações para a aprovação:**
1. `Title` como chave única é o que garante o *upsert* idempotente. Se o dono preferir
   `Title` legível (o objeto), então é preciso um campo indexado extra
   `NumeroControlePNCP` — mas aí a unicidade fica menos óbvia.
2. `StatusTriagem` e `MotivoDescarte` são **de escrita humana**. Qualquer sincronização
   futura deve fazer *merge*, nunca sobrescrever esses dois.
3. Indexar `UF`, `Score` e `DataEncerramentoProposta` (as views vão filtrar por eles).
4. Lista tende a crescer rápido; vale uma política de arquivamento de editais com
   encerramento vencido, para não bater no limite de view do SharePoint.

## Pendências

1. **Critérios reais da Seção 4** de `Perfil_Eletrium_Licitacoes.md` — escopo técnico,
   faixa de valor e prioridade geográfica. **Bloqueia a utilidade real do filtro.**
2. Provavelmente serão necessários **termos de exclusão** (curso, capacitação,
   pós-graduação…), que hoje não existem no modelo.
3. **Aprovação do schema** de `Radar_Editais` acima — antes disso, nada é criado no SharePoint.
4. Definir onde/como agendar a execução periódica (Agendador de Tarefas do Windows,
   Power Automate, etc.) — ainda não definido.
