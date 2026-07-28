# Radar de Editais PNCP — Eletrium

Script Node que consulta a **API pública de consultas do PNCP** (Portal Nacional de
Contratações Públicas), filtra editais por relevância para a Eletrium e grava os
relevantes em arquivo (JSON consultável + HTML de leitura).

- Arquivo: `pncp-radar.js`
- Saída: `pncp-radar-data/radar-editais.json` e `pncp-radar-data/radar-editais.html`
- Requisitos: **Node >= 18** (usa `fetch` global). Testado em Node v24.14.1.
- **Sem dependências externas. Sem autenticação.**

---

## Critérios — Seção 4 do Perfil de Licitações da Eletrium

Os critérios do bloco `CONFIG` no topo de `pncp-radar.js` são a tradução fiel da
**Seção 4** fornecida pelo dono. A regra de ouro é:

> **Só duas coisas cortam: não casar palavra-chave de escopo, ou bater num termo de
> exclusão. Valor e UF apenas CLASSIFICAM.** Toda reprovação sai com motivo
> rastreável no console e no JSON (`motivoDescarte`).

### A · Escopo de serviço — palavras-chave (basta UMA casar)

`spda` · `descarg atmosferic` · `para raio` · `nbr 5419` · `aterrament` · `nr 12` ·
`nr 10` · `nbr 5410` · `instalac eletric` · `manutenc eletric` · `subestac` ·
`cabine primari` · `laudo eletric`

### B · Porte/valor — **classifica, não corta**

| `valorTotalEstimado` | Classificação | Score |
|---|---|---|
| sem valor informado | `valor não informado` | — |
| < R$ 5.000 | `abaixo da faixa` | — |
| R$ 5.000 – 500.000 | `na faixa` | **+1** |
| R$ 500.001 – 1.000.000 | `acima da faixa` | — (**neutro — lacuna**) |
| > R$ 1.000.000 | `avaliar consórcio` | — (nunca descarta) |

### C · Órgão contratante / geografia — **classifica, não corta**

`MG` → `prioritário` (**+2** de score) · demais UFs → `avaliar logística`
(sem bônus, **sem descarte**) · UF ausente → `UF não informada`.

> `--uf` **não** mexe nisso: ele restringe o **escopo da consulta** (operacional,
> para rodar mais rápido). A prioridade geográfica é critério de negócio e vive em
> `UFS_PRIORITARIAS`. Antes esses dois conceitos eram a mesma variável — configurar
> a prioridade teria silenciosamente parado de consultar o resto do Brasil.

### D · Qualificação técnica — **NÃO AUTOMATIZÁVEL — avaliação humana**

Atestado compatível (SPDA/NBR 5419 ou NBR 5410/NR-10), ART em 10–15 dias após a
assinatura, soma de atestados e patrimônio líquido **não existem na API de
consulta** — estão no PDF do edital. **Nenhuma heurística foi inventada para isso.**
Cada edital aprovado carrega o campo `avaliacaoHumanaPendente` com essa checklist,
para que a lacuna fique visível na triagem em vez de escondida.

### E · Bônus

**+1** (uma vez, não por termo) se o objeto menciona `spda`, `para raio`, `nr 12`,
`nr 10` ou `aterrament`. O outro item do bônus — *"prazo compatível com estrutura
sem consórcio"* — **não é automatizável** (o prazo de execução não vem na API);
entrou na checklist de avaliação humana.

---

## Termos de exclusão — o que reprova, e por quê

Um edital que casa palavra-chave mas bate numa destas regras é **reprovado com
motivo registrado**. Duas defesas contra falso-negativo:

- **`minimoTermos: 2`** em categorias ambíguas — exige que a categoria seja
  *dominante* no objeto, não uma palavra solta.
- **`resgatavelPorNucleo`** — a presença de um sinal de escopo **núcleo**
  (`spda`, `descarg atmosferic`, `para raio`, `nbr 5419`, `aterrament`, `nr 10`,
  `nr 12`, `nbr 5410`, `cabine primari`, `laudo eletric`) **cancela a exclusão**.
  É assim que se implementa o *"…sem componente elétrico"* da Seção 4.
  Repare que `instalac eletric`, `manutenc eletric` e `subestac` **não** são núcleo
  de propósito: são justamente os termos que aparecem de passagem.

| Regra | Reprova quando | Mín. termos | Resgatável pelo núcleo |
|---|---|---|---|
| `ensino` | curso, treinamento, capacitação, pós-graduação, workshop, palestra, seminário, material didático, apostila, instrutor | 1 | **não** — um curso *sobre* SPDA continua sendo um curso |
| `facilities` | limpeza, portaria, copeiragem, conservação, jardinagem, recepção, vigilância, asseio, zeladoria, terceirização, auxiliar de serviços, posto de trabalho | **2** | sim |
| `alta-tensao` | alta tensão, linha de transmissão, subestação de transmissão, extra alta | 1 | não |
| `geracao` | geração de energia, usina hidrelétrica/termelétrica/fotovoltaica, parque eólico, central geradora, sistema fotovoltaico | 1 | sim |
| `obra-civil` | obra civil, engenharia/cálculo/reforço estrutural, muro de arrimo, terraplanagem, pavimentação asfáltica, recapeamento, drenagem pluvial, calçamento | **2** | sim |
| `ti-redes` | rede lógica, rede de dados, cabeamento estruturado, fibra óptica, data center, CPD, link de internet, software, licença de uso | **2** | sim |

### Detalhe que evita um bug real: exclusão usa match ESTRITO

A inclusão tem um atalho *squash* (ignora separadores, para casar `NR-10`/`NR 10`/
`NR10`). **A exclusão não usa esse atalho** — só o radical com fronteira de palavra.
Motivo concreto: `squash("curso") = "curso"`, que está contido em **"con-curso"**.
Com squash, todo edital com a palavra "concurso" seria reprovado como ensino.
Exclusão é irreversível para o edital, então exige o match mais rigoroso.
Há teste unitário para exatamente esse caso.

---

## ⚠️ A regra da subestação — o conflito, e como foi resolvido

`subestac` é palavra-chave de **inclusão** e trouxe os melhores resultados do teste
real. Mas a Seção 4 exclui *"alta tensão / subestações de **grande porte**"*. Nem
toda subestação é de grande porte — uma de 15 kV é **cabine primária**, que a
própria Eletrium lista como escopo.

**Regra adotada — subestação não é excluída por si; só com sinal OBJETIVO de porte:**

| Situação | Decisão |
|---|---|
| tensão em kV explícita **> 34,5** (69 / 138 / 230 kV…) | **EXCLUI** — `porte-alta-tensao` |
| termo explícito: "alta tensão", "linha de transmissão", "subestação de transmissão" | **EXCLUI** — `alta-tensao` |
| tensão em kV explícita **≤ 34,5** (13,8 / 15 / 23 / 34,5 kV) | **MANTÉM** — média tensão = cabine primária = escopo |
| subestação **sem tensão informada** | **MANTÉM + ALERTA** "verificar porte no edital" |

Detalhes da implementação:

- A varredura de tensão roda sobre o texto **quase cru** (só minúsculas/sem acento),
  porque `normalizar()` transformaria `13,8 kV` em `13 8 kv` e destruiria o decimal.
- **`kVA` é ignorado de propósito** — é potência, não tensão. Sem isso, um edital de
  *"subestação aérea de 75 kVA"* (pequeno porte, alvo perfeito) seria lido como
  75 kV e excluído como alta tensão.
- O limite mora em `TENSAO_KV_LIMITE` (34,5 = fronteira normativa entre média e
  alta tensão no Brasil).

### Divergência deliberada da sugestão do dono — precisa de decisão

O dono sugeriu tratar a frase **"subestação de energia"** como sinal de grande porte.
**Não foi adotada como sinal isolado**, porque ela reprovaria o edital do
SAAE de Aracruz/ES — *"SUBESTAÇÃO DE ENERGIA ELÉTRICA **CLASSE 15KV**"* — que é
média tensão, ou seja, exatamente cabine primária. Adotar a frase criaria uma
contradição interna: excluir por "subestação de energia" o que a lista de
palavras-chave inclui por "cabine primária".

**Para adotar a sugestão do dono, é um interruptor:** trocar
`SUBESTACAO_SEM_TENSAO_INFORMADA` de `"sinalizar"` para `"excluir"`. Isso derruba
toda subestação que não declara tensão (hoje: 5 dos 10 editais do radar, incluindo
a obra de R$ 8,4 mi da UNIRIO). **Decisão do dono, não do script.**

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
node pncp-radar.js --uf MG            # RESTRINGE a consulta a MG (mais rápido, cobertura menor)
node pncp-radar.js --saida ./outro    # outro diretório de saída
node pncp-radar.js --help
```

**Sobre o tempo de execução:** a varredura nacional completa é cara. Com ~26 mil
contratações abertas, 50 por página e 2 s entre requisições (cadência necessária
para não tomar 429), são ~530 páginas ≈ **18 minutos**. `--uf MG` reduz
drasticamente o volume (mas perde editais de fora, que a Seção 4 manda **manter**
como "avaliar logística" — então use só para teste). `--max-paginas` sempre marca a
saída como **VARREDURA PARCIAL** — nunca finge cobertura total.

---

## Resultado do teste real (2026-07-28, `--dias 45 --max-paginas 30`)

Varredura parcial de 1.500 registros (30 de 530 páginas), mesmos parâmetros da
execução anterior, que tinha produzido **10 relevantes** com os critérios placeholder.

| Etapa | Antes (placeholder) | Depois (Seção 4) |
|---|---|---|
| registros únicos analisados | 1.500 | 1.500 |
| reprovados por palavra-chave | 1.490 | 1.489 |
| passaram por palavra-chave | 10 | 11 |
| reprovados por **exclusão** | — (não existia) | **1** (`facilities`) |
| reprovados por score mínimo | 0 | 0 |
| **RELEVANTES** | **10** | **10** |

Classificação dos 10 (nenhuma delas corta): porte — 5 `na faixa`, 3 `avaliar
consórcio`, 1 `acima da faixa` (a banda indefinida), 1 `abaixo da faixa`;
geografia — 1 `prioritário` (MG), 9 `avaliar logística`.

### Mudanças de status

Para separar **mudança de critério** de **variação do corpus da API** (a cada dia o
PNCP devolve um conjunto diferente), os 10 editais da execução anterior foram
reavaliados **offline** com os critérios novos. Resultado: **exatamente 1 mudou de
status.**

| Edital | Antes | Depois | O que mudou |
|---|---|---|---|
| ALE-RN, R$ 7,6 mi | score 1, no radar | **REPROVADO `facilities`** | limpeza + portaria + copeiragem + jardinagem + recepção + auxiliar de serviços. Falso positivo apontado pelo dono — resolvido |
| Rebouças/PR (iluminação + SPDA) | score 1 | **score 4** | +1 palavra-chave nova (`descarg atmosferic`), +1 valor na faixa, +1 bônus SPDA |
| Concórdia/SC (SPDA + aterramento) | score 2 | **score 3** | +1 bônus. `avaliar consórcio` (R$ 4,3 mi). **Não** foi excluído por TI apesar de citar rede lógica/datacenter/CPD — resgatado pelo núcleo (SPDA) |
| Araquari/SC ×3 (subestação em escolas) | score 1 | **score 2** | +1 valor na faixa. Alerta "subestação SEM tensão informada" |
| Aracruz/ES (subestação **classe 15 kV**) | score 1 | score 1 | **mantido** — 15 kV é média tensão. Alerta "dentro do escopo" + `avaliar consórcio` |
| UNIRIO/RJ (subestação, R$ 8,4 mi) | score 1 | score 1 | **mantido** — sem tensão declarada → alerta, não descarte. `avaliar consórcio` |
| CORES/CE (subestação aérea **75 kVA**) | score 1 | score 1 | **mantido** — kVA não é lido como kV. `abaixo da faixa` (valor declarado: R$ 1) |
| Teotônio Vilela/AL (manutenção predial + elétrica) | score 1 | score 1 | **mantido** — não bateu em `obra-civil` (pavimentação/drenagem genéricas não são marcadores) nem em `facilities` |

**Nenhum edital foi perdido para a regra da subestação** — os três melhores achados
do teste anterior (UNIRIO, Araquari, Aracruz) continuam no radar. Só o falso
positivo de facilities caiu.

Na execução ao vivo entrou também **1 edital novo, o de maior score e o único de MG**:
SAAE de Sabinópolis/MG — eletricista PJ sob demanda, manutenção preventiva e
corretiva, R$ 111.000 → **score 4** (1 palavra-chave + 2 MG + 1 na faixa). Ele não
estava na amostra anterior por variação do corpus, não por mudança de critério.

### Testes unitários

49 asserções, todas passando, cobrindo: os dois falsos positivos apontados pelo dono
(pós-graduação e facilities) reprovando; edital legítimo de SPDA passando com score
correto; `curso` ≠ `concurso`; toda a tabela de porte da subestação (138/69/34,5/15 kV,
75 kVA, sem tensão); todas as 9 fronteiras da classificação de valor; UF não cortando;
resgate por núcleo; e `filtrar()` produzindo `motivoDescarte`.

**Idempotência confirmada de novo:** 2ª execução → `10 editais (0 novos, 10
atualizados, 0 removidos)`, `primeiroContatoEm` preservado, 10 IDs únicos.

---

## Fórmula do score

```
score = (nº de PALAVRAS_CHAVE DISTINTAS encontradas no texto do objeto)
      + 2   se a UF do órgão é prioritária          (Seção 4 C — MG)
      + 1   se valorTotalEstimado está NA FAIXA     (Seção 4 B — R$ 5 mil a 500 mil)
      + 1   se o objeto menciona um TERMO DE BÔNUS  (Seção 4 E — uma vez só,
            SPDA / para-raios / NR-12 / NR-10 / aterramento)
```

- Texto analisado: `objetoCompra` + `informacaoComplementar`.
- Entra no radar quem tiver **≥ 1 palavra-chave**, **não bater em termo de exclusão**
  e **score ≥ `SCORE_MINIMO`** (=1).
- Ordenação: score decrescente, depois encerramento mais próximo.
- A mesma fórmula está no `--help` e em `criteriosUsados.formulaScore` no JSON.

Exemplo real (edital de Rebouças/PR): `spda` + `descarg atmosferic` = 2 palavras-chave,
fora de MG (+0), R$ 270.730 na faixa (+1), menciona SPDA (+1) → **score 4**.

### Como as palavras-chave casam

Os termos são escritos como **radicais (stems)**, e o matcher permite até 3 letras
extras no fim de cada palavra — assim plural e flexão são cobertos sem duplicar
entradas:

- `"instalac eletric"` → casa "instalação elétrica", "instalações elétricas"
- `"subestac"` → casa "subestação", "subestações"

A comparação é **sem acento e sem diferenciar maiúsculas**
(`normalize("NFD")` + remoção de diacríticos). Há ainda um match "colado"
(*squash*) que ignora separadores, então `"nr 10"` casa com **NR-10**, **NR 10** e
**NR10**. Validado por 49 casos de teste, todos passando (ver "Testes unitários"
acima). **Esse atalho vale só para a inclusão** — a exclusão usa match estrito, pelo
motivo explicado na seção de termos de exclusão.

### Transparência do funil — nada é descartado em silêncio

Cascata impressa a cada execução (e gravada em `estatisticasUltimaExecucao`):

```
registros da API → páginas lidas → recebidos → duplicados → únicos
  - reprovados por palavra-chave
  - reprovados por termo de EXCLUSÃO   (quebrado por regra: ensino, facilities, …)
  - reprovados por score mínimo
  >> RELEVANTES
CLASSIFICAÇÃO (não corta): porte/valor e geografia, contados por categoria
DESCARTADOS COM MOTIVO: um por um, com regra, termos que casaram e trecho do objeto
SAÍRAM DO RADAR: editais que estavam no store e agora batem em exclusão
```

No JSON isso vira três coleções separadas:

- `editais` — o radar (cumulativo, idempotente).
- `descartadosUltimaExecucao` — quem casou palavra-chave e **caiu depois**, com
  `regraDescarte`, `motivoDescarte` e `termosDescarte`. Serve para auditar o filtro:
  se algo bom aparecer aqui, o critério precisa de ajuste.
- `removidosDoRadarNestaExecucao` — quem **estava** no radar e saiu porque o critério
  mudou. Sem isso, o store cumulativo eternizaria aprovações de um critério antigo.

Reprovação por não casar palavra-chave é contada, mas não listada item a item
(seriam ~1.500 linhas por execução). As demais são listadas individualmente.

Regras deliberadas: **edital sem `valorTotalEstimado` não é descartado** (só recebe a
etiqueta `valor não informado`); **edital de qualquer UF entra** (fora de MG recebe
`avaliar logística`); **edital acima de R$ 1 mi entra** com `avaliar consórcio`.
Descartar por omissão do órgão ou por porte seria perder oportunidade.

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
  *(Verificado: 2ª execução → "10 editais (0 novos, 10 atualizados, 0 removidos)".)*
  Exceção deliberada ao "cumulativo": se um edital que já estava no store passa a
  bater num termo de exclusão, ele **sai** do radar e vai para
  `removidosDoRadarNestaExecucao` com o motivo — senão uma aprovação de critério
  antigo ficaria lá para sempre.
- **Sem stack trace cru**: falhas viram mensagem em português para o operador.
- Lista vazia e `204 No Content` são tratados como resultado válido, não como erro.

## Saída

- **`radar-editais.json`** — store consultável: critérios usados (inclusive as regras
  de exclusão inteiras e `regraSubestacao` em texto), avisos do que é provisório,
  estatísticas do funil, `editais`, `descartadosUltimaExecucao` e
  `removidosDoRadarNestaExecucao`.
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

## 🟡 O que continua PROVISÓRIO ou em aberto

Não está escondido no código de propósito — aparece no `--help`, no banner de
execução, no `AVISO_PROVISORIO` do JSON e no topo do HTML.

1. **A faixa de valor R$ 5.000–500.000 é provisória** — a própria Seção 4 diz isso.
   Mora em `VALOR_FAIXA_MIN` / `VALOR_FAIXA_MAX`.
2. **A banda R$ 500.001–1.000.000 não é definida pela Seção 4.** Não está na faixa e
   também não é o gatilho de consórcio (~R$ 1 mi). Tratada como **neutra**: não
   pontua, não descarta, e o edital recebe um alerta explícito dizendo que essa
   banda é uma lacuna. **Precisa de decisão do dono.**
3. **Seção 4 D (qualificação técnica) não é automatizável** — atestado compatível,
   ART em 10–15 dias, soma de atestados, patrimônio líquido. Nada disso vem na API
   de consulta. Fica como **avaliação humana** (`avaliacaoHumanaPendente`).
   Nenhuma heurística foi inventada.
4. **"Prazo compatível sem consórcio" (bônus E) também não é automatizável** — o
   prazo de execução não vem na API. Entrou na mesma checklist humana.
5. **A sugestão "subestação de energia" como sinal de grande porte não foi adotada** —
   ver a seção da regra da subestação acima. Precisa do "ok" do dono para virar
   `SUBESTACAO_SEM_TENSAO_INFORMADA: "excluir"`.
6. **`TENSAO_KV_LIMITE = 34,5`** é a fronteira normativa média/alta tensão. Se a
   Eletrium na prática não atende nem 23 kV, o número deve baixar.
7. **Calibragem dos termos de exclusão** é empírica e deve ser revisada com o dono
   olhando `descartadosUltimaExecucao` de algumas execuções reais. Pontos que já
   exigiram julgamento: `pavimentação`/`drenagem` genéricas **não** entraram como
   marcadores de obra civil (senão derrubariam contratos de manutenção predial que
   têm lote elétrico legítimo); `mão de obra` **não** é marcador de facilities
   (aparece em "com fornecimento de materiais e mão de obra" em editais bons).
8. **`esferaId` do órgão é gravado mas não filtrado** — a Seção 4 C cita autarquias,
   fundações e empresas públicas, todas já dentro do universo do PNCP. Fica
   disponível para triagem humana em vez de virar um corte não pedido.

## Pendências operacionais

1. **Aprovação do schema** de `Radar_Editais` acima — antes disso, nada é criado no
   SharePoint. (Se aprovado, vale acrescentar `ClassificacaoUF` e `FaixaValor`, que
   agora existem no JSON, e um campo para os `Alertas`.)
2. Definir onde/como agendar a execução periódica (Agendador de Tarefas do Windows,
   Power Automate, etc.) — ainda não definido.
3. Rodar **sem `--max-paginas`** (varredura nacional completa, ~18 min) para uma
   medição real de recall — os números acima vêm de 30 das 530 páginas.
