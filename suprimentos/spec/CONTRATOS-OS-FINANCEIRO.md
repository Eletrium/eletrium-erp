# Contratos externos — OS e Financeiro

## OS → Suprimentos

A OS envia `os.consume.v1` com a cadeia completa
`Proposta_ID → Projeto_ID → Pacote_ID → OS_ID → Necessidade_ID`, itens, referência da
reserva, versão do documento, `expectedVersions`, idempotência e correlação. Suprimentos
não lê nem altera a máquina de estados da OS. Versão desconhecida é rejeitada.

## Suprimentos → Financeiro

Após Pedido × Recebimento × NF-e validado, Suprimentos publica
`finance.obligation.v1`: fornecedor, pedido, nota, valor, vencimento e evidência. O
Financeiro responde pela obrigação e caixa; o evento não contém comando de estoque.

## Compatibilidade

- alterações aditivas exigem nova versão minor do contrato;
- remoção, renomeação ou mudança semântica exige versão major e convivência temporária;
- descrições nunca substituem IDs;
- status visual não autoriza consumo, pagamento ou compensação;
- testes `suprimentos-contract-schemas` e `suprimentos-boundary-e2e` são o consumer
  contract executável enquanto CRM/OS permanecem em desenvolvimento separado.
