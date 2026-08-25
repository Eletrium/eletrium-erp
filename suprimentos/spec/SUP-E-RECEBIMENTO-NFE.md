# SUP-E — Recebimento, NF-e e reconciliação

## Fluxo
`Pedido de Compra → Recebimento Físico → Staging NF-e → Matching → Aceite/Divergência → Entrada de Estoque/Custo`

## Regras
- recebimento usa cabeçalho + itens;
- NF-e entra primeiro em staging;
- Chave_NFe é única;
- matching compara Pedido × Recebido × NF-e;
- quantidade rejeitada não entra em estoque;
- NF-e sem pedido não movimenta estoque automaticamente;
- custo só é reconhecido após aceite conforme política vigente;
- divergência exige motivo, responsável e evidência;
- correções são novos eventos, nunca edição destrutiva do ledger.

## Tipos de divergência
SEM_PEDIDO | QUANTIDADE | PRECO | ITEM | TRIBUTO | FRETE | DANIFICADO | NAO_CONFORME | OUTRA

## Evidências mínimas
- Pedido_ID/Versao;
- Recebimento_ID;
- Chave_NFe quando houver;
- item/material;
- quantidade aceita/rejeitada;
- usuário/data;
- anexo ou observação quando divergente.

## Gate E
- recebimento parcial preserva saldo pendente;
- NF-e duplicada é rejeitada;
- divergência bloqueia promoção automática correspondente;
- aceite gera movimento de entrada idempotente;
- reprocessamento não duplica estoque/custo.

## Implementação de referência

`suprimentos/core/receiving.js` implementa recebimento parcial, staging com unicidade de
chave NF-e, matching Pedido × Recebimento × NF-e, bloqueio por divergência e promoção
idempotente para eventos de entrada/custo. Quantidade rejeitada nunca compõe o movimento
de entrada; NF-e sem pedido permanece em staging e não promove efeitos.
O movimento preserva `Item_ID`, versão do pedido, correlação e chave idempotente para ser
consumido diretamente pelo ledger de SUP-B.

`tests/suprimentos-receiving.test.js` cobre todos os critérios do Gate E. O custo gerado
é apenas evento interno vinculado à política versionada; não há chamada ao Financeiro ou
ao Bom Controle.

## Não colisão
Nenhuma chamada ao Bom Controle é ativada nesta frente. Integração fiscal externa só entra pelo Gate H após homologação.
