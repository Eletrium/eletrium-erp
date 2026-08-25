# Delta futuro de integração com `suprimentos.html`

Este documento não autoriza alteração da tela. Ele define o delta esperado para revisão
de conflito quando os contratos estiverem homologados.

## Regra de chamada

`suprimentos.html → command gateway → core/adapter → persistência`

É proibido `tela → SharePoint/API Bom Controle`.

## Comandos previstos

| Ação da tela | Comando | Campos mínimos | Erros que devem aparecer |
|---|---|---|---|
| Reservar | `reserve` | documento, versão, itens, expectedVersions, idempotencyKey | falta, conflito, leitura incompleta |
| Liberar | `release` | origem da reserva, quantidade, versão | saldo insuficiente, conflito |
| Consumir | `consume` | reserva, material, quantidade, correlação | estoque físico, conflito, reconciliação |
| Reprocessar | `manualRetry` | evento, justificativa, operador | teto, efeito incerto, permissão |
| Receber | `receive` | pedido, itens aceitos/rejeitados, evidência | divergência, duplicidade NF-e |

## Componentes desacoplados

- caixa de exceções derivada de eventos;
- detalhe da necessidade por IDs;
- visão de projeção com versão/reconciliação;
- modal de conflito que obriga releitura;
- painel de divergência Pedido × Recebimento × NF-e;
- indicadores derivados, nunca botões de alteração direta de status.

## Arquivos compartilhados

Antes da integração devem ser comparados:

- `suprimentos.html` contra a linha ativa de CRM/OS;
- `graph.js` somente se o gateway existente precisar de extensão;
- qualquer helper comum de ETag/paginação.

O delta só poderá ser aplicado após apresentação do diff e confirmação de que não há
colisão com CRM, OS ou a máquina de estados em andamento.
