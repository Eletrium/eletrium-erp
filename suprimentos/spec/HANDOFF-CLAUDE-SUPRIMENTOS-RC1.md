# Handoff para Claude — Suprimentos RC1

## O que consumir

- contrato OS: `contracts/commands.v1.json`, operação `os.consume.v1`;
- fixture: `fixtures/os-consumer-contract.v1.json`;
- verificação: `node suprimentos/tools/verify-os-contract.js <payload.json>`;
- builder pronto: `integration/os-consumption-producer.js`, que monta o envelope e
  bloqueia retry com chave ou payload alterados;
- fronteira: OS envia IDs, versão, itens, ETag lógico e idempotência; não importa core
  de Suprimentos e Suprimentos não lê a máquina de estados da OS.

## Critério objetivo de aceite

1. payload retorna `compatible=true` no verificador;
2. retry usa a mesma `Idempotency_Key` e o mesmo payload;
3. alteração de payload usa uma nova chave;
4. `Proposta_ID → Projeto_ID → Pacote_ID → OS_ID → Necessidade_ID` está completa;
5. consumo referencia a reserva por documento, versão e item;
6. nenhum status visual autoriza consumo;
7. erro 409/412 exige releitura, nunca overwrite;
8. timeout com efeito incerto vai para reconciliação.

## Arquivos proibidos nesta integração

Não alterar por este handoff: `suprimentos.html`, `inbound.html`, `reaquecimento.html`,
`outbox.js`, helpers de CRM ou a máquina de estados da OS. Se a OS precisar mudar o
contrato, criar versão nova; não editar silenciosamente `1.0.0`.

## Comandos de validação

```bash
node suprimentos/tools/verify-os-contract.js
node tests/run-suprimentos.js
node suprimentos/tools/homologation-evidence.js
```

Na branch `active-field-v2.1-20260824` inspecionada em 25/08/2026 não existe produtor de
consumo de material; há somente a ação visual “Buscar material”. O Claude não precisa
reconstruir ledger, Graph, retry, UI ou reconciliação: basta alimentar o builder com os
IDs relacionais e persistir o envelope no outbox da OS.
