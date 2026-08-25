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

## Implementação de referência

`suprimentos/core/purchasing.js` implementa:

- solicitação rastreável até `Projeto_ID + Necessidade_ID + Item_ID + Material_ID`;
- rodada de cotação versionada com fornecedor por ID, evidência, validade, preço, frete,
  impostos e prazo;
- mapa comparativo determinístico por custo total entregue, prazo e fornecedor;
- aprovação vinculada à versão da política/alçada e ao snapshot da rodada;
- pedido imutável derivado exclusivamente da oferta aprovada, preservando
  `Solicitacao_Compra_ID + Item_ID + Material_ID` para o matching de recebimento;
- reprocessamento idempotente com rejeição de chave reutilizada para payload diferente;
- nova rodada obrigatória para mudança pós-aprovação, preservando o snapshot anterior.

TS-33 a TS-40 estão implementados em `tests/suprimentos-purchasing.test.js`. O núcleo não
integra Financeiro, NF-e, Bom Controle, CRM ou OS e não realiza chamadas externas.

## Não colisão
Compras trabalha somente com contratos de Projeto/Necessidade e não altera CRM, OS ou Financeiro. A integração fiscal permanece fora desta frente.
