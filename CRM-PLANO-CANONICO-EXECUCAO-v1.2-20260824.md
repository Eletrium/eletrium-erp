# Eletrium ERP — CRM v1.2 — Plano Canônico de Execução

Data de consolidação: 24/08/2026
Branch de integração: `active-crm-v1.2-20260821`
Base histórica da retomada: `master@1c80e626d349489e7f06148ad74fb8f86722d68c`

> **ESTE É O ROTEIRO OPERACIONAL CANÔNICO DO CRM A PARTIR DE 24/08/2026.**
> O arquivo `CRM-RETOMADA-v1.2.md` permanece como contexto de abertura da retomada, mas não deve ser usado sozinho para decidir prioridade, gate ou implementação.

## 1. Taxonomia oficial — não misturar sistemas de gate

Existem dois conjuntos de gates em documentos/histórico do projeto:

1. **G0/G1/... históricos** — pertencem a iniciativas/cenários antigos, especialmente à linha anterior do Outbound/Make. Podem ser usados como testes locais ou referência histórica de um cenário, mas **NÃO são os gates globais da retomada CRM v1.2**.
2. **Gate A–E da retomada v1.2** — estes são os gates atuais por frente:
   - Gate A = CRM-A / Inbound + Auditoria;
   - Gate B = CRM-B / Outbound;
   - Gate C = CRM-C / Licitações;
   - Gate D = CRM-D / Indicação;
   - Gate E = CRM-E / Reaquecimento + Observabilidade.

Nenhuma frente fecha gate por documentação, mock ou tela estática. Gate exige prova funcional da própria frente.

## 2. Arquitetura comum fechada

Os cinco funis são: **Inbound, Outbound, Licitações, Indicação e Reaquecimento**.

Regras comuns:
- Inbound, Outbound, Licitações e Indicação convergem para `Fila_Auditoria_Leads` antes de qualquer promoção comercial.
- Lead cru nunca cria proposta automaticamente.
- Promoção humana é o gate entre captação/triagem e pipeline comercial.
- Reaquecimento é exceção: sinaliza/organiza ação humana; não cria proposta automaticamente.
- Persistência vem antes da IA; IA nunca pode ser o ponto único de perda de lead.
- `Submission_ID` identifica a submissão e deve ser idempotente.
- `ID_Origem` identifica a entrada estável no funil.
- CPF/CNPJ identifica Conta; **não deduplica uma nova demanda/oportunidade**.
- `Status_Processamento`, `Status_Auditoria` e `Status_Promocao` são estados independentes.
- Choices de SharePoint devem ser validados contra o schema real; não hardcodar rótulo inexistente.
- 429/5xx podem ter retry controlado; 401/403 não entram em loop automático.

Pipeline comercial após promoção humana:
`Lead Novo → Qualificação → Em Elaboração → Enviada → Em Negociação → Aguardando Decisão → Ganho → Perdido`.

## 3. Ownership atual

- **Code 3**: auditor do CRM v1.2 e investigador live de Make/SharePoint; não deve implementar silenciosamente em branch de outro owner.
- **Code 1 / CRM-A**: Inbound, `Fila_Auditoria_Leads`, persistência antes da IA, DLQ/erro e promoção humana.
- **Claude / CRM-B**: Outbound — este é o escopo prioritário do Claude. Não deve tentar coordenar/reescrever as cinco frentes ao mesmo tempo.
- **CRM-C**: Licitações/PNCP, branch `crm-c-licitacoes-auditoria`.
- **CRM-D**: Indicação, branch `crm-d-indicacao`.
- **CRM-E**: Reaquecimento/observabilidade, branch `crm-e-reaquecimento-observabilidade`; Code 3 pode auditar/rebasear conforme coordenação.

Todos os PRs são contra `active-crm-v1.2-20260821`, nunca direto em `master`.

## 4. Estado factual por frente em 24/08

### CRM-A — Inbound / Auditoria
Estado:
- é a frente mais madura e a única já investigada com dados reais da `Fila_Auditoria_Leads`;
- `inbound.html` versionado continua em contenção (`ENVIO_HABILITADO=false` / `noindex,nofollow`), então não há evidência de tráfego público real nesta fase;
- PR #10 permanece draft;
- a investigação live do Code 3 sobre o cenário Make Inbound `5792583` classificou 11 de 14 ocorrências de DLQ/Warning; 3 ficaram fora da retenção da API e devem permanecer `NÃO EXECUTÁVEL`, nunca presumidas.

Classificação reportada pelo Code 3 (evidência live dele; não reproduzida independentemente neste documento):
- 4 falhas de teste ligadas à chamada Gemini: 2 HTTP 400 + 2 respostas não JSON parseáveis;
- nesses quatro casos, `Dados_Brutos` era literalmente `"1"` — payload sintético de desenvolvimento, não lead real;
- 1 submissão malformada foi persistida com erro, comportamento correto fail-open-to-audit;
- 7 execuções marcadas `Warning` no Make tinham item real persistido, `Retry_Count=0` e `Trilha_Erro` vazia — sem evidência de perda de lead;
- hipótese mais consistente para os 7 warnings: interrupções de testes manuais no período de desenvolvimento.

**Correção pré-lançamento obrigatória:** alinhar a chamada Gemini do Inbound ao modo JSON já aplicado em outro cenário (`responseMimeType: application/json`) e provar com payload realista. Não ativar landing por causa disso; é apenas uma correção necessária antes de lançamento.

Gate A fecha somente quando:
1. persistência antes da IA estiver provada no blueprint/live;
2. falha de IA deixar o lead recuperável na auditoria;
3. retry da mesma submissão não duplicar;
4. promoção humana for idempotente;
5. nenhum caminho criar proposta sem aprovação humana;
6. schema/Choices reais estiverem reconciliados;
7. só então envio público + indexação poderão ser considerados juntos.

### CRM-B — Outbound — PRIORIDADE DO CLAUDE
Estado:
- PR #8 draft e atualmente não mergeável até reconciliação/rebase com a branch ativa;
- implementação atual é deliberadamente local/client-side;
- `outbound.html` prepara piloto de até 20 linhas, lote determinístico e quarentena;
- **não grava diretamente na `Fila_Auditoria_Leads`** — isso é correto;
- cenário Make histórico `5617113` precisa ser reconciliado/recuperado; não contornar erro de blueprint pulando staging.

Fluxo obrigatório do Outbound:
`origem/arquivo → Lote_Importacao_ID + Linha_Origem_ID → staging → quarentena por linha → persistência → enriquecimento/classificação → Fila_Auditoria_Leads → aprovação humana → pipeline comercial`.

**Claude deve executar nesta ordem:**

B0. Rebasear/reconciliar `crm-b-outbound-piloto` com `active-crm-v1.2-20260821`; nenhum force-push sobre branch alheia sem coordenação.

B1. Inventariar o cenário Make `5617113` e o schema/lista real de staging. Se o staging real não existir ou não estiver formalizado, registrar a lacuna; **não inventar lista em produção**.

B2. Corrigir primeiro o cenário/blueprint até ficar estruturalmente válido. Não ativar automação enquanto houver erro de validação.

B3. Persistir lote/linhas antes de IA/enriquecimento. Cada linha deve ter identidade estável e resultado independente.

B4. Implementar/quebrar por linha:
- válida → `RECEBIDO`/estado equivalente confirmado no schema real;
- inválida → `QUARENTENA` com motivo;
- falha de uma linha não aborta as demais;
- reimportar mesmo arquivo não duplica lote/linhas.

B5. Só depois ligar enriquecimento/classificação. IA nunca decide se o registro existe; apenas enriquece/classifica um registro já persistido.

B6. Convergir os candidatos válidos para `Fila_Auditoria_Leads` com `Submission_ID`, `ID_Origem`, origem e raw rastreáveis.

B7. **Não implementar cadência comercial automática ainda.** Contato/cadência fica fora do gate até o núcleo Outbound → Auditoria estar provado e houver autorização específica.

B8. Piloto real controlado de **20 linhas** e reconciliação 20/20.

Provas mínimas do Gate B:
- mesmo `Lote_Importacao_ID + Linha_Origem_ID` não duplica staging;
- linha ruim vai para quarentena sem perder linhas boas;
- 20/20 entradas reconciliadas origem → staging/quarentena → auditoria quando elegíveis;
- 0 duplicação silenciosa;
- 0 proposta automática;
- falhas/retries observáveis;
- payload sintético/malformado não derruba o lote;
- Gemini/enriquecedor deve produzir JSON parseável ou erro rastreável, nunca perda silenciosa.

Somente depois destas provas o PR #8 pode deixar draft e ser candidato ao Gate B.

### CRM-C — Licitações / PNCP
Estado:
- PR #6 draft;
- existe UI autenticada/ponte proposta, mas o inventário live apontou incompatibilidade de schemas e a ponte ainda não está provada end-to-end.

Ordem:
C1. Reconciliar schema canônico da `Fila_Auditoria_Leads` e campos PNCP; não manter dois contratos concorrentes.
C2. Usar `numeroControlePNCP` como `PNCP_ID`/`ID_Origem` estável e `Submission_ID` idempotente.
C3. Provar 3–5 editais identificáveis entrando na Auditoria.
C4. Reprocessamento não duplica oportunidade; atualização preserva histórico/versionamento.
C5. Requisito não extraível automaticamente mantém `Avaliacao_Humana_Pendente`/equivalente e bloqueia promoção, não a persistência.
C6. Nenhuma proposta automática.

### CRM-D — Indicação
Estado:
- PR #7 draft;
- autenticação e desenho de ID existem, mas o caminho real ainda não foi exercitado.

Ordem:
D1. Confirmar schema real da fila e `Submission_ID` UNIQUE.
D2. Gerar `Indicacao_ID` uma vez e reutilizá-lo em retry; o mesmo ID alimenta `Submission_ID`/`ID_Origem`.
D3. Registrar 3–5 indicações identificáveis.
D4. Retry da mesma indicação não duplica.
D5. Origem/indicador/contexto permanecem rastreáveis.
D6. Nenhuma proposta automática.

### CRM-E — Reaquecimento / Observabilidade
Estado:
- PR #9 draft; branch foi rebaseada/atualizada segundo relatório do Code 3;
- núcleo de staleness é trabalho real e deve ser preservado;
- ainda falta ligar fonte real de heartbeat/política à tela e provar o comportamento.

Ordem:
E1. Rebase limpo contra a branch ativa atual e eliminar conflitos documentais.
E2. Confirmar heartbeat real do espelho; `Clientes.Modified`, `Data_Ultima_Compra` e horário de carregamento não servem como heartbeat.
E3. Confirmar política/limiar real; ausência de heartbeat ou política = `NÃO VERIFICÁVEL`, nunca `FRESCO` por inferência.
E4. Provar `FRESCO`, `STALE` e `NÃO VERIFICÁVEL` com fonte real/sandbox equivalente.
E5. Ação comercial continua humana; zero proposta automática.

## 5. Ordem de integração recomendada

A construção pode continuar em paralelo, mas a integração deve respeitar dependências:

1. **reconciliar schema comum da `Fila_Auditoria_Leads`**;
2. fechar CRM-A como contrato comum de persistência/auditoria;
3. fechar CRM-B Outbound sobre o contrato comum;
4. fechar CRM-C e CRM-D em paralelo;
5. fechar CRM-E independentemente, desde que não reescreva o contrato comum;
6. somente depois consolidar a onda na branch `active-crm-v1.2-20260821`;
7. `master` só recebe onda consolidada e revisada.

Isso não significa que B/C/D precisam esperar A para escrever código. Significa que **nenhum deles pode fechar gate com um schema comum ainda divergente**.

## 6. O que NÃO fazer

- Não usar G0–G11 histórico como checklist global do CRM v1.2.
- Não transformar warnings de testes manuais em incidente de produção sem evidência.
- Não apagar/ignorar DLQ fora da retenção; marcar `NÃO EXECUTÁVEL`.
- Não ligar `inbound.html` público antes do Gate A.
- Não pular staging no Outbound.
- Não deduplicar lead por CNPJ/razão social.
- Não criar proposta automaticamente a partir de captura/IA.
- Não hardcodar Choice não confirmado no SharePoint.
- Não usar mock/tela estática como fechamento de gate.
- Não mergear PR draft só porque o frontend renderiza.

## 7. Evidência obrigatória por gate

Cada fechamento deve conter, no mínimo:
- repo + branch + SHA;
- blueprint/scenario ID quando houver Make;
- schema/lista SharePoint usada;
- IDs dos registros de teste reais/sandbox identificáveis;
- teste de retry/idempotência;
- teste de falha/erro observável;
- reconciliação origem → destino;
- confirmação explícita de zero proposta automática quando aplicável;
- red-team/revisão independente para mudança de regra de negócio, dedupe, identidade ou automação.

## 8. Regra de comunicação para agentes

Antes de iniciar trabalho, o agente deve declarar:
1. frente (`CRM-A`..`CRM-E`);
2. branch;
3. etapa desta lista (ex.: `B2`);
4. artefato que pretende alterar;
5. evidência que pretende produzir.

Ao finalizar, deve reportar:
- o que foi implementado;
- o que foi apenas investigado;
- testes executados e resultados;
- dado real vs mock;
- bloqueios remanescentes;
- SHA/PR;
- qual etapa é a próxima.

**Nenhum agente deve responder apenas “pronto” ou “gate fechado” sem essa rastreabilidade.**
