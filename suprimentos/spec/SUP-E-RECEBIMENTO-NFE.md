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

## Não colisão
Nenhuma chamada ao Bom Controle é ativada nesta frente. Integração fiscal externa só entra pelo Gate H após homologação.