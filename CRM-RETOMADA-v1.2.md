# CRM Eletrium — Retomada v1.2

Data: 21/08/2026
Branch ativa: `active-crm-v1.2-20260821`
Base: `master@1c80e626d349489e7f06148ad74fb8f86722d68c`

## Objetivo
Retomar a construção do CRM em paralelo ao corredor de go-live do módulo de OS, sem compartilhar branches, gates ou arquivos críticos com `eletrium-field`.

## Regras que permanecem fechadas
- Cinco funis: Inbound, Outbound, Licitações, Indicação e Reaquecimento.
- Inbound/Outbound/Licitações/Indicação convergem para `Fila_Auditoria_Leads` antes de qualquer promoção comercial.
- Lead cru nunca cria proposta automaticamente.
- Promoção humana é o gate entre captação/triagem e pipeline comercial.
- Pipeline de propostas: Lead Novo → Qualificação → Em Elaboração → Enviada → Em Negociação → Aguardando Decisão → Ganho → Perdido.
- Reaquecimento é exceção: não entra automaticamente na Fila_Auditoria e não cria proposta; gera sinal/ação humana.
- Persistência do lead vem antes de IA; classificação por IA não pode ficar no caminho crítico da captura.
- 429/5xx podem ter retry controlado; 401/403 não entram em loop.

## Delta real encontrado no repositório
O `master` contém `inbound.html`, `propostas.html`, `nova-proposta.html`, `reaquecimento.html`, `clientes.html` e o radar PNCP, mas não existe uma frente Outbound materializada.

`inbound.html` ainda está em contenção (`ENVIO_HABILITADO=false`, `noindex,nofollow`) e o próprio código registra cenário Make pausado/indisponível. Portanto a primeira ação não é simplesmente reativar a landing: é reconciliar o estado operacional real do Make com o estado versionado antes de remover a contenção.

## Frentes paralelas

### Frente CRM-A — Núcleo, Auditoria e Inbound
Escopo:
- confirmar schema real de `Fila_Auditoria_Leads`, `Clientes` e `Propostas`;
- reconciliar estado real do cenário Inbound com a contenção versionada;
- provar persistência antes da IA;
- provar falha de IA sem perda de lead;
- definir evidência para religar envio + `index,follow` juntos;
- validar promoção humana idempotente para Conta/Cliente + Proposta.

Gate A:
- lead válido chega à Fila_Auditoria com ID rastreável;
- falha de IA mantém lead recuperável;
- reenvio não duplica;
- nenhum caminho cria proposta sem aprovação humana.

### Frente CRM-B — Outbound
Escopo:
- criar a primeira implementação versionada de Outbound;
- piloto controlado de 20 linhas;
- dedupe por empresa/contato/origem;
- enriquecimento e personalização fora do caminho crítico de persistência;
- todos os candidatos convergem para Fila_Auditoria;
- cadência/contato somente após decisão humana de ativação.

Gate B:
- 20 registros reconciliados origem → auditoria;
- zero duplicação silenciosa;
- zero proposta automática;
- falhas/retry observáveis.

### Frente CRM-C — Licitações
Escopo:
- preservar o radar PNCP já existente;
- criar ponte `Radar_Editais → Fila_Auditoria_Leads`;
- chave idempotente por `numeroControlePNCP`;
- checklist humana para requisitos não disponíveis na API/PDF;
- nenhuma oportunidade vira proposta sem gate humano.

Gate C:
- edital selecionado chega à auditoria com origem, score, motivo e link;
- reprocessamento não duplica;
- edital descartado mantém motivo rastreável.

### Frente CRM-D — Indicação
Escopo:
- entrada manual rastreável;
- origem/indicador obrigatório;
- consentimento e dados mínimos;
- dedupe antes da auditoria;
- promoção segue exatamente o mesmo gate humano dos demais funis.

Gate D:
- criação, dedupe, auditoria e promoção comprovadas com dados de teste.

### Frente CRM-E — Reaquecimento + Observabilidade
Escopo:
- manter tela autenticada;
- preservar regra de nenhuma proposta automática;
- implementar ação humana explícita sobre cliente em risco;
- adicionar indicador objetivo de frescor/staleness do espelho;
- centralizar logs, erros, retry e métricas dos cinco funis;
- alertar quando cenário/espelho para de atualizar sem transformar isso em exposição pública de dados.

Gate E:
- espelho fresco e stale distinguíveis;
- falha/desativação do cenário fica visível;
- nenhuma ação automática comercial indevida;
- métricas mínimas: entradas, rejeições, auditoria pendente, promoção, falha e retry.

## Integração
Cada frente trabalha em branch própria a partir de `active-crm-v1.2-20260821` e abre PR draft contra a branch ativa. Não trabalhar diretamente em `master`.

Merge para a branch ativa exige:
1. teste específico da frente;
2. evidência de dado real ou sandbox equivalente identificável;
3. revisão independente quando houver mudança de regra de negócio, identidade, dedupe ou automação;
4. zero regressão nos gates já fechados.

`master` só recebe uma onda consolidada depois de integração das frentes aprovadas.
