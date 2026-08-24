# SUP-D — Compras P0

## Fluxo
`Necessidade/Falta → Solicitação de Compra → Rodada de Cotação → Mapa Comparativo → Aprovação → Pedido de Compra → Confirmação/Follow-up`

## Modelo
### Solicitação
Cabeçalho + itens. Cada item mantém Necessidade_ID, Projeto_ID, Material_ID, quantidade, data necessária e criticidade.

### Cotação
- Rodada_ID e Versao;
- fornecedor por item;
- preço unitário, frete, impostos quando aplicável, prazo, condição de pagamento, validade;
- evidência/origem da proposta;
- snapshot imutável após aprovação.

### Aprovação
- alçada versionada;
- aprovador, data e justificativa;
- reprovação e retorno para nova rodada sem apagar histórico.

### Pedido
- Pedido_ID e Versao;
- fornecedor;
- itens provenientes da rodada aprovada;
- quantidade/preço/prazo congelados no snapshot;
- estado separado do estado da solicitação.

## Exceções
- fornecedor não responde;
- cotação vencida;
- mudança de quantidade após aprovação;
- item crítico sem fornecedor;
- pedido parcial;
- atraso de entrega;
- cancelamento com trilha.

## Testes Gate D
TS-33..40 devem cobrir criação, versionamento, mapa comparativo, aprovação/alçada, pedido, reprocessamento idempotente e exceções.

## Não colisão
Compras trabalha somente com contratos de Projeto/Necessidade e não altera CRM, OS ou Financeiro. A integração fiscal permanece fora desta frente.