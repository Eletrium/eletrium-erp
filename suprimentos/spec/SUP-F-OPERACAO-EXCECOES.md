# SUP-F — Operação por exceção

## Objetivo
Transformar Suprimentos em caixa de trabalho operacional, não em painel decorativo.

## Fila de exceções
Cada exceção deve conter:
- Excecao_ID
- Tipo
- Entidade / Entity_ID
- Projeto_ID quando aplicável
- Criticidade
- Data_Necessaria
- Responsavel
- Acao_Recomendada
- Correlation_ID
- Status
- SLA/idade
- Ultimo_Erro
- Retry_Count

## Categorias mínimas
ESTOQUE_INSUFICIENTE | COMPRA_ATRASADA | COTACAO_PENDENTE | APROVACAO_PENDENTE | RECEBIMENTO_DIVERGENTE | NFE_DIVERGENTE | SYNC_ERROR | RECONCILIACAO_PENDENTE | MATERIAL_CRITICO_OS

## Princípios
- KPI deriva de ledger/eventos; não substitui evidência.
- erro persistente permanece visível até resolução/reconciliação.
- reprocessamento preserva histórico.
- documentos operacionais são versionados/editáveis por nova versão.
- nenhuma exceção crítica é encerrada apenas por alteração visual de status.

## Painel P0
- críticos hoje/atrasados;
- faltas por projeto;
- compras aguardando ação;
- recebimentos divergentes;
- erros de integração/reconciliação;
- responsável e próxima ação.

## Gate F
Painel deve ser reconstruível a partir dos dados canônicos, sem estado paralelo oculto e sem depender de CRM/OS para renderizar a fila de Suprimentos.

## Implementação de referência

`suprimentos/core/exceptions.js` mantém a trilha append-only `ABERTA → ATRIBUIDA /
REPROCESSADA → RESOLVIDA → REABERTA` e reconstrói fila, idade, atraso e KPIs a partir dos
eventos. Resolução exige tipo e evidência; um status visual isolado não encerra exceção.
Retry idempotente preserva o erro e incrementa a contagem sem duplicar evento.

`tests/suprimentos-exceptions.test.js` comprova reconstrução, persistência de falha,
resolução/reabertura com histórico, idempotência e independência de estado de CRM/OS.
Nenhuma interface foi alterada: o painel futuro consumirá essa projeção após os contratos
e gates de integração estarem consolidados.
