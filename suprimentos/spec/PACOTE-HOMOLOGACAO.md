# Pacote de homologação de Suprimentos

## Evidências automatizadas

1. executar `node tests/run-suprimentos.js --json` e arquivar a saída;
2. executar `node suprimentos/tools/readiness-report.js` e arquivar o relatório;
3. executar `node suprimentos/tools/homologation-evidence.js` para consolidar testes,
   Gates e fingerprint do release candidate;
4. capturar metadados do site SharePoint e executar o harness de homologação;
5. arquivar fingerprints desejado/observado e plano dry-run;
6. executar corrida de último saldo, fuzzing e reconstrução de 5.000 eventos;
7. injetar 412, paginação quebrada, worker morto, falha antes do commit, ACK perdido e efeito parcial;
8. confirmar que nenhuma chamada Bom Controle ocorreu e que `productionEnabled=false`;
9. comparar arquivos do PR com a lista protegida antes de qualquer integração.

## Critérios humanos

- service account e ownership aprovados;
- permissões do tenant iguais ao contrato, com CRM sem escrita;
- lease/fila de consumidor único escolhido para implantação horizontal;
- operador consegue distinguir conflito, falta e reconciliação pendente;
- Financeiro valida somente o contrato de obrigação, sem assumir estoque;
- equipe de OS valida IDs e comando de consumo sem acoplar sua máquina de estados;
- rollback por compensação e rebuild ensaiado em homologação.

## Únicos itens que exigem ambiente ou outra trilha

- site/listas SharePoint reais, service account e política de segredos;
- teste E2E autenticado com ETag real e lease/fila distribuída;
- delta final de `suprimentos.html`, depois da comparação com CRM/OS;
- estabilização do contrato de consumo da OS;
- evidências do Gate 0 do Bom Controle (chave, schemas, DLP, retry e reconciliação).

Esses itens não bloqueiam evolução ou teste local de SUP-A a SUP-F.
